package com.z2846852.bodytrace;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.DataInputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.zip.InflaterInputStream;

/**
 * Streaming, dependency-free BTDPAT01 signed-APK delta decoder.
 *
 * Unlike ZIP reconstruction, this preserves the target APK's original byte-for-
 * byte v2 signature block, central directory, compression and signing metadata.
 * The caller MUST also validate Android package name, version and signing cert
 * before handing the reconstructed APK to the system installer.
 */
final class ApkDeltaPatch {
    private static final byte[] MAGIC=new byte[]{
        'B','T','D','P','A','T','0','1'
    };
    private static final int CHUNK=64*1024;
    private static final int MAX_LITERAL=1<<20;
    private static final int MAX_PACKED=MAX_LITERAL+4096;
    private ApkDeltaPatch(){}

    static String sha256(File file) throws Exception {
        MessageDigest digest=MessageDigest.getInstance("SHA-256");
        byte[] buffer=new byte[CHUNK];
        try(InputStream input=new BufferedInputStream(new FileInputStream(file))){
            int count;
            while((count=input.read(buffer))!=-1)digest.update(buffer,0,count);
        }
        return hex(digest.digest());
    }

    private static String hex(byte[] raw) {
        StringBuilder result=new StringBuilder(raw.length*2);
        for(byte b:raw)result.append(String.format(java.util.Locale.ROOT,"%02x",b&0xff));
        return result.toString();
    }

    private static long positiveLong(DataInputStream stream) throws Exception {
        long value=stream.readLong();
        if(value<0)throw new SecurityException("差分补丁包含非法偏移或大小");
        return value;
    }

    static void apply(File oldApk,File patchFile,File outputApk) throws Exception {
        if(!oldApk.isFile()||!patchFile.isFile())
            throw new IllegalArgumentException("更新所需的旧版 APK 或补丁不存在");
        if(outputApk.exists())throw new IllegalStateException("目标 APK 必须不存在");
        try(DataInputStream patch=new DataInputStream(
                new BufferedInputStream(new FileInputStream(patchFile)));
            RandomAccessFile original=new RandomAccessFile(oldApk,"r");
            OutputStream output=new BufferedOutputStream(new FileOutputStream(outputApk))){
            byte[] magic=new byte[8];
            patch.readFully(magic);
            if(!Arrays.equals(magic,MAGIC))
                throw new SecurityException("不支持的 APK 差分格式");
            long originalSize=positiveLong(patch);
            long newSize=positiveLong(patch);
            if(originalSize!=original.length()||newSize<=0||newSize>200L*1024*1024)
                throw new SecurityException("差分文件大小不合法");
            byte[] oldHash=new byte[32],newHash=new byte[32];
            patch.readFully(oldHash);
            patch.readFully(newHash);
            if(!sha256(oldApk).equals(hex(oldHash)))
                throw new SecurityException("已安装 APK 与补丁来源不一致");

            byte[] buffer=new byte[CHUNK];
            MessageDigest newDigest=MessageDigest.getInstance("SHA-256");
            long written=0;
            while(true){
                int command=patch.read();
                if(command=='E')break;
                if(command==-1)throw new EOFException("APK 差分补丁不完整");
                if(command=='C'){
                    long offset=positiveLong(patch);
                    long length=Integer.toUnsignedLong(patch.readInt());
                    if(length<=0||offset>originalSize||length>originalSize-offset||
                            length>newSize-written)
                        throw new SecurityException("差分旧版复制区间非法");
                    original.seek(offset);
                    long remaining=length;
                    while(remaining>0){
                        int wanted=(int)Math.min(remaining,CHUNK);
                        original.readFully(buffer,0,wanted);
                        output.write(buffer,0,wanted);
                        newDigest.update(buffer,0,wanted);
                        remaining-=wanted;
                    }
                    written+=length;
                }else if(command=='L'){
                    long rawLength=Integer.toUnsignedLong(patch.readInt());
                    long compressedLength=Integer.toUnsignedLong(patch.readInt());
                    if(rawLength<=0||rawLength>MAX_LITERAL||
                            compressedLength<=0||compressedLength>MAX_PACKED||
                            rawLength>newSize-written)
                        throw new SecurityException("差分字面量大小非法");
                    byte[] compressed=new byte[(int)compressedLength];
                    patch.readFully(compressed);
                    try(InflaterInputStream uncompress=new InflaterInputStream(
                            new java.io.ByteArrayInputStream(compressed))){
                        long left=rawLength;
                        while(left>0){
                            int wanted=(int)Math.min(left,CHUNK);
                            int n=uncompress.read(buffer,0,wanted);
                            if(n<=0)throw new EOFException("差分解压数据不足");
                            output.write(buffer,0,n);
                            newDigest.update(buffer,0,n);
                            left-=n;
                        }
                        if(uncompress.read()!=-1)
                            throw new SecurityException("差分解压数据长度不匹配");
                    }
                    written+=rawLength;
                }else{
                    throw new SecurityException("未知差分指令");
                }
                if(written>newSize)throw new SecurityException("差分输出超过声明大小");
            }
            if(patch.read()!=-1||written!=newSize||
                    !hex(newDigest.digest()).equals(hex(newHash)))
                throw new SecurityException("差分还原 APK 的 SHA256 或长度错误");
            output.flush();
        }catch(Exception failure){
            Files.deleteIfExists(outputApk.toPath());
            throw failure;
        }
    }
}
