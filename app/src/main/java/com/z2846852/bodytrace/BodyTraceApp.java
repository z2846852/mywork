package com.z2846852.bodytrace;

import android.app.Application;
import android.content.Context;

/** Local-only crash breadcrumbs; never upload stack traces or personal data. */
public final class BodyTraceApp extends Application {
    private static final String PREFS="bodytrace_startup_diagnostics";

    static void record(Context context,String category,String detail){
        try{
            String message=category+": "+(detail==null?"":detail);
            if(message.length()>1600)message=message.substring(0,1600);
            context.getSharedPreferences(PREFS,MODE_PRIVATE).edit()
                .putLong("last_error_ms",System.currentTimeMillis())
                .putString("last_error",message).commit();
        }catch(Exception ignored){}
    }

    @Override public void onCreate(){
        super.onCreate();
        final Thread.UncaughtExceptionHandler previous=
            Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread,error)->{
            try{
                StringBuilder note=new StringBuilder(error.getClass().getName());
                if(error.getMessage()!=null)note.append(": ").append(error.getMessage());
                StackTraceElement[] frames=error.getStackTrace();
                for(int i=0;i<Math.min(4,frames.length);i++)
                    note.append("\n").append(frames[i].toString());
                record(this,"Java exception",note.toString());
            }catch(Throwable ignored){}
            if(previous!=null&&previous!=Thread.getDefaultUncaughtExceptionHandler())
                previous.uncaughtException(thread,error);
            else android.os.Process.killProcess(android.os.Process.myPid());
        });
    }
}
