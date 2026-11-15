package com.dayangspa.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

@CapacitorPlugin(
    name = "BluetoothPrinter",
    permissions = {
        @Permission(alias = "bluetoothConnect", strings = { Manifest.permission.BLUETOOTH_CONNECT })
    }
)
public class BluetoothPrinterPlugin extends Plugin {
    private static final UUID SERIAL_PORT_PROFILE = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int MAX_TEXT_LENGTH = 16_384;
    private static final long PRINTER_IDLE_TIMEOUT_SECONDS = 120;

    private final ExecutorService printExecutor = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService disconnectExecutor = Executors.newSingleThreadScheduledExecutor();
    private final Object printerLock = new Object();
    private BluetoothSocket printerSocket;
    private OutputStream printerOutputStream;
    private String printerAddress;
    private ScheduledFuture<?> disconnectTask;
    private boolean destroyed;

    @PluginMethod
    public void listPairedDevices(PluginCall call) {
        if (needsConnectPermission()) {
            requestPermissionForAlias("bluetoothConnect", call, "listPermissionCallback");
            return;
        }

        listPairedDevicesWithPermission(call);
    }

    @PluginMethod
    public void printText(PluginCall call) {
        if (needsConnectPermission()) {
            requestPermissionForAlias("bluetoothConnect", call, "printPermissionCallback");
            return;
        }

        printTextWithPermission(call);
    }

    @PluginMethod
    public void preparePrinter(PluginCall call) {
        if (needsConnectPermission()) {
            requestPermissionForAlias("bluetoothConnect", call, "preparePermissionCallback");
            return;
        }

        preparePrinterWithPermission(call);
    }

    @PermissionCallback
    private void listPermissionCallback(PluginCall call) {
        if (getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Izin perangkat Bluetooth diperlukan untuk melihat printer yang sudah dipasangkan.");
            return;
        }

        listPairedDevicesWithPermission(call);
    }

    @PermissionCallback
    private void printPermissionCallback(PluginCall call) {
        if (getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Izin perangkat Bluetooth diperlukan untuk mencetak.");
            return;
        }

        printTextWithPermission(call);
    }

    @PermissionCallback
    private void preparePermissionCallback(PluginCall call) {
        if (getPermissionState("bluetoothConnect") != PermissionState.GRANTED) {
            call.reject("Izin perangkat Bluetooth diperlukan untuk menyiapkan printer.");
            return;
        }

        preparePrinterWithPermission(call);
    }

    private boolean needsConnectPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            && getPermissionState("bluetoothConnect") != PermissionState.GRANTED;
    }

    private void listPairedDevicesWithPermission(PluginCall call) {
        try {
            BluetoothAdapter adapter = getEnabledAdapter();
            Set<BluetoothDevice> pairedDevices = adapter.getBondedDevices();
            List<BluetoothDevice> devices = new ArrayList<>(pairedDevices);
            Collections.sort(devices, (left, right) -> {
                String leftName = left.getName() == null ? "" : left.getName();
                String rightName = right.getName() == null ? "" : right.getName();
                int nameComparison = leftName.compareToIgnoreCase(rightName);
                return nameComparison != 0 ? nameComparison : left.getAddress().compareTo(right.getAddress());
            });

            JSArray result = new JSArray();
            for (BluetoothDevice device : devices) {
                JSObject item = new JSObject();
                item.put("id", device.getAddress());
                item.put("name", device.getName() == null ? "Printer Bluetooth" : device.getName());
                result.put(item);
            }

            JSObject response = new JSObject();
            response.put("devices", result);
            call.resolve(response);
        } catch (IllegalStateException | SecurityException exception) {
            call.reject(exception.getMessage());
        }
    }

    private void printTextWithPermission(PluginCall call) {
        String deviceId = call.getString("deviceId");
        String text = call.getString("text");

        if (deviceId == null || !BluetoothAdapter.checkBluetoothAddress(deviceId)) {
            call.reject("Pilih alamat printer Bluetooth yang valid.");
            return;
        }
        if (text == null || text.isEmpty() || text.length() > MAX_TEXT_LENGTH || !text.matches("[ -~\\r\\n]*")) {
            call.reject("Teks struk harus berisi karakter ASCII cetak dan maksimal 16.384 karakter.");
            return;
        }

        try {
            BluetoothAdapter adapter = getEnabledAdapter();
            BluetoothDevice device = findPairedDevice(adapter, deviceId);
            byte[] receiptBytes = text.getBytes(StandardCharsets.US_ASCII);
            printExecutor.execute(() -> sendToPrinter(call, device, receiptBytes));
        } catch (IllegalStateException | SecurityException exception) {
            call.reject(exception.getMessage());
        } catch (RejectedExecutionException exception) {
            call.reject("Tidak dapat memulai koneksi printer Bluetooth.");
        }
    }

    private void preparePrinterWithPermission(PluginCall call) {
        String deviceId = call.getString("deviceId");
        if (deviceId == null || !BluetoothAdapter.checkBluetoothAddress(deviceId)) {
            call.reject("Pilih alamat printer Bluetooth yang valid.");
            return;
        }

        try {
            BluetoothAdapter adapter = getEnabledAdapter();
            BluetoothDevice device = findPairedDevice(adapter, deviceId);
            printExecutor.execute(() -> {
                try {
                    synchronized (printerLock) {
                        if (destroyed) throw new IOException("Koneksi printer sudah ditutup.");
                        getConnectedPrinter(device);
                        schedulePrinterDisconnect();
                    }
                    JSObject result = new JSObject();
                    result.put("ready", true);
                    call.resolve(result);
                } catch (IOException | SecurityException exception) {
                    synchronized (printerLock) {
                        closePrinterSocket();
                    }
                    call.reject(
                        "Printer belum siap. Pastikan printer menyala, terpasang, dan mendukung Bluetooth Classic SPP. "
                            + exception.getMessage(),
                        exception
                    );
                }
            });
        } catch (IllegalStateException | SecurityException exception) {
            call.reject(exception.getMessage());
        } catch (RejectedExecutionException exception) {
            call.reject("Tidak dapat memulai koneksi printer Bluetooth.");
        }
    }

    private BluetoothAdapter getEnabledAdapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null) {
            throw new IllegalStateException("Perangkat ini tidak memiliki Bluetooth.");
        }
        if (!adapter.isEnabled()) {
            throw new IllegalStateException("Nyalakan Bluetooth lalu muat ulang daftar printer.");
        }
        return adapter;
    }

    private BluetoothDevice findPairedDevice(BluetoothAdapter adapter, String deviceId) {
        for (BluetoothDevice device : adapter.getBondedDevices()) {
            if (deviceId.equalsIgnoreCase(device.getAddress())) {
                return device;
            }
        }
        throw new IllegalStateException("Printer tidak lagi dipasangkan. Pasangkan kembali lalu muat ulang daftar.");
    }

    private void sendToPrinter(PluginCall call, BluetoothDevice device, byte[] receiptBytes) {
        IOException lastError = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                synchronized (printerLock) {
                    if (destroyed) throw new IOException("Koneksi printer sudah ditutup.");
                    getConnectedPrinter(device);
                    if (disconnectTask != null) {
                        disconnectTask.cancel(false);
                        disconnectTask = null;
                    }

                    byte[] job = new byte[receiptBytes.length + 5];
                    job[0] = 0x1B;
                    job[1] = 0x40;
                    System.arraycopy(receiptBytes, 0, job, 2, receiptBytes.length);
                    job[job.length - 3] = 0x1B;
                    job[job.length - 2] = 0x64;
                    job[job.length - 1] = 0x04;
                    printerOutputStream.write(job);
                    printerOutputStream.flush();
                    schedulePrinterDisconnect();
                }

                JSObject result = new JSObject();
                result.put("sent", true);
                result.put("attempts", attempt + 1);
                call.resolve(result);
                return;
            } catch (IOException exception) {
                lastError = exception;
                synchronized (printerLock) {
                    closePrinterSocket();
                }
                if (attempt == 0) {
                    try {
                        Thread.sleep(300);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        call.reject("Percobaan cetak dibatalkan.", interrupted);
                        return;
                    }
                }
            } catch (SecurityException exception) {
                synchronized (printerLock) {
                    closePrinterSocket();
                }
                call.reject(
                    "Izin Bluetooth tidak tersedia. Izinkan akses perangkat Bluetooth lalu coba cetak lagi. "
                        + exception.getMessage(),
                    exception
                );
                return;
            }
        }

        call.reject(
            "Struk belum terkirim setelah dua percobaan. Pastikan printer menyala, kertas tersedia, "
                + "dan printer mendukung Bluetooth Classic SPP/ESC-POS. "
                + (lastError == null ? "" : lastError.getMessage()),
            lastError
        );
    }

    private BluetoothSocket getConnectedPrinter(BluetoothDevice device) throws IOException {
        String address = device.getAddress();
        if (printerSocket != null && printerOutputStream != null
            && address.equalsIgnoreCase(printerAddress) && printerSocket.isConnected()) {
            return printerSocket;
        }

        closePrinterSocket();
        IOException lastError = null;
        for (int attempt = 0; attempt < 2; attempt++) {
            BluetoothSocket socket = device.createRfcommSocketToServiceRecord(SERIAL_PORT_PROFILE);
            try {
                socket.connect();
                printerOutputStream = socket.getOutputStream();
                printerSocket = socket;
                printerAddress = address;
                return socket;
            } catch (IOException | SecurityException exception) {
                try {
                    socket.close();
                } catch (IOException ignored) {
                    // Preserve the original connection error.
                }
                if (exception instanceof SecurityException) throw (SecurityException) exception;
                lastError = (IOException) exception;
                if (attempt == 0) {
                    try {
                        Thread.sleep(300);
                    } catch (InterruptedException interrupted) {
                        Thread.currentThread().interrupt();
                        throw new IOException("Koneksi printer dibatalkan.", interrupted);
                    }
                }
            }
        }
        throw lastError == null ? new IOException("Tidak dapat menyambungkan printer.") : lastError;
    }

    private void schedulePrinterDisconnect() {
        if (disconnectTask != null) disconnectTask.cancel(false);
        disconnectTask = disconnectExecutor.schedule(() -> {
            synchronized (printerLock) {
                closePrinterSocket();
            }
        }, PRINTER_IDLE_TIMEOUT_SECONDS, TimeUnit.SECONDS);
    }

    private void closePrinterSocket() {
        if (disconnectTask != null) {
            disconnectTask.cancel(false);
            disconnectTask = null;
        }
        if (printerSocket != null) {
            try {
                printerSocket.close();
            } catch (IOException ignored) {
                // The socket is discarded regardless of close outcome.
            }
        }
        printerSocket = null;
        printerOutputStream = null;
        printerAddress = null;
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (printerLock) {
            destroyed = true;
            closePrinterSocket();
        }
        disconnectExecutor.shutdownNow();
        printExecutor.shutdownNow();
        super.handleOnDestroy();
    }
}
