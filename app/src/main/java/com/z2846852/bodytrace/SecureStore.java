package com.z2846852.bodytrace;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Encrypt bearer token, cached CSV and queued events with Android Keystore AES-GCM. */
final class SecureStore {
    private static final String ALIAS = "bodytrace-vault-v1";
    private static final int IV_BYTES = 12;
    private final SharedPreferences prefs;

    SecureStore(Context context) {
        prefs = context.getSharedPreferences("bodytrace-private", Context.MODE_PRIVATE);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        SecretKey existing = (SecretKey) store.getKey(ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true).build());
        return generator.generateKey();
    }

    synchronized void write(String name, String value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        // Android Keystore keys with randomizedEncryptionRequired=true forbid a
        // caller-provided IV on encryption. Keystore must generate it.
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] ct = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        byte[] iv = cipher.getIV();
        // Keep the original 12-byte-IV-prefix storage format so read() remains
        // backward-compatible with any previously saved ciphertext.
        if (iv == null || iv.length != IV_BYTES) {
            throw new IllegalStateException("Unexpected Android Keystore GCM IV length");
        }
        byte[] all = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(ct, 0, all, iv.length, ct.length);
        prefs.edit().putString(name, Base64.encodeToString(all, Base64.NO_WRAP)).apply();
    }

    synchronized String read(String name) throws Exception {
        String encoded = prefs.getString(name, null);
        if (encoded == null) return null;
        byte[] all = Base64.decode(encoded, Base64.DEFAULT);
        if (all.length <= IV_BYTES) throw new IllegalStateException("Corrupt local data");
        byte[] iv = new byte[IV_BYTES];
        byte[] ct = new byte[all.length - IV_BYTES];
        System.arraycopy(all, 0, iv, 0, IV_BYTES);
        System.arraycopy(all, IV_BYTES, ct, 0, ct.length);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(ct), StandardCharsets.UTF_8);
    }

    synchronized void clear() {
        prefs.edit().clear().apply();
    }
}
