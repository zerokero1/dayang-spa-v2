package com.dayangspa.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WhatsAppShare")
public class WhatsAppSharePlugin extends Plugin {
    @PluginMethod
    public void shareMessage(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.trim().isEmpty()) {
            call.reject("Pesan daftar WhatsApp kosong.");
            return;
        }

        Intent shareIntent = new Intent(Intent.ACTION_SEND);
        shareIntent.setType("text/plain");
        shareIntent.putExtra(Intent.EXTRA_TEXT, text);

        try {
            getActivity().startActivity(Intent.createChooser(shareIntent, "Pilih WhatsApp untuk mengirim daftar"));
            JSObject result = new JSObject();
            result.put("opened", true);
            result.put("chooser", true);
            call.resolve(result);
        } catch (ActivityNotFoundException | SecurityException exception) {
            call.reject("Tidak ada aplikasi yang bisa membagikan daftar. Pastikan WhatsApp terpasang.", exception);
        }
    }
}
