package com.z2846852.bodytrace;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;

/**
 * Read-only, single-file content URI for Android's real APK installer.
 * No file:// URI exposure and no access to recordings, tokens or arbitrary
 * app-private files. Callers must receive the explicit one-time URI grant.
 */
public final class ApkInstallProvider extends ContentProvider {
    private File fileFor(Uri uri)throws FileNotFoundException {
        if(getContext()==null||uri==null||
           !(getContext().getPackageName()+".apkupdate").equals(uri.getAuthority())||
           !"/verified.apk".equals(uri.getPath())){
            throw new FileNotFoundException("Unknown APK update URI");
        }
        File apk=new File(new File(getContext().getFilesDir(),"apk_updates"),
            "verified.apk");
        if(!apk.isFile()||apk.length()<=0)
            throw new FileNotFoundException("No verified APK update");
        return apk;
    }
    @Override public boolean onCreate(){return true;}
    @Override public String getType(Uri uri){return "application/vnd.android.package-archive";}
    @Override public ParcelFileDescriptor openFile(Uri uri,String mode)
            throws FileNotFoundException{
        if(!"r".equals(mode))throw new FileNotFoundException("Read-only update provider");
        return ParcelFileDescriptor.open(fileFor(uri),ParcelFileDescriptor.MODE_READ_ONLY);
    }
    @Override public Cursor query(Uri uri,String[] projection,String selection,
            String[] selectionArgs,String sortOrder) {
        try{
            File apk=fileFor(uri);
            String[] columns=projection==null?
                new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;
            MatrixCursor result=new MatrixCursor(columns,1);
            Object[] values=new Object[columns.length];
            for(int i=0;i<columns.length;i++){
                if(OpenableColumns.DISPLAY_NAME.equals(columns[i]))
                    values[i]="BodyTrace-update.apk";
                else if(OpenableColumns.SIZE.equals(columns[i]))values[i]=apk.length();
            }
            result.addRow(values);
            return result;
        }catch(Exception ignored){return null;}
    }
    @Override public Uri insert(Uri uri,ContentValues values){throw new SecurityException("Read only");}
    @Override public int update(Uri uri,ContentValues values,String selection,
            String[] selectionArgs){throw new SecurityException("Read only");}
    @Override public int delete(Uri uri,String selection,String[] selectionArgs){
        throw new SecurityException("Read only");
    }
}
