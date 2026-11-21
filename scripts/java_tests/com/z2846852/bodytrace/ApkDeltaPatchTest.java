package com.z2846852.bodytrace;

import java.io.File;
import java.nio.file.Files;
import java.util.Arrays;

/** Tests the production Java streaming decoder using Python-produced fixtures. */
public final class ApkDeltaPatchTest {
    private static void check(boolean yes,String message){
        if(!yes)throw new AssertionError(message);
    }
    public static void main(String[] args)throws Exception{
        File base=new File("build/delta_test");
        File original=new File(base,"old.apk");
        File expected=new File(base,"new.apk");
        File patch=new File(base,"update.btpatch");
        File output=new File(base,"restored.apk");
        Files.deleteIfExists(output.toPath());
        ApkDeltaPatch.apply(original,patch,output);
        check(Arrays.equals(Files.readAllBytes(expected.toPath()),
            Files.readAllBytes(output.toPath())),"Java reconstructed APK bytes differ");
        check(ApkDeltaPatch.sha256(output).equals(ApkDeltaPatch.sha256(expected)),
            "SHA256 mismatch");
        Files.deleteIfExists(output.toPath());
        try{
            ApkDeltaPatch.apply(original,new File(base,"bad.btpatch"),output);
            throw new AssertionError("Corrupted APK patch was incorrectly accepted");
        }catch(SecurityException|java.util.zip.ZipException|
                java.io.EOFException correct){
            check(!output.exists(),"Corrupted APK patch left an installable file");
        }
        System.out.println("ApkDeltaPatchTest passed (byte-identical + corrupt rejection)");
    }
}
