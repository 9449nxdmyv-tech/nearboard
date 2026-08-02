package app.nearboard.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/**
 * Keeps the mesh alive while the app is not on screen.
 *
 * Android stops a backgrounded app from scanning and advertising within
 * minutes, which for this app means the mesh quietly dies the moment someone
 * puts their phone in a pocket — exactly when a board most needs to keep
 * working. A foreground service is the only supported way to continue, and it
 * comes with a permanent notification by design: the platform requires that
 * anything running in the background be visible, and for an app using Bluetooth
 * continuously that requirement is reasonable.
 *
 * The notification is written to be useful rather than apologetic. It says what
 * the app is doing and offers a way to stop it, because a persistent
 * notification the user cannot dismiss and cannot act on is the kind that gets
 * an app uninstalled.
 *
 * This does NOT make the two platforms equal. iOS cannot do the same: a
 * backgrounded iOS app advertises into the overflow area, visible only to
 * another iOS device scanning for that exact service UUID, and never to
 * Android. The UI must not imply otherwise.
 */
public class MeshForegroundService extends Service {

    public static final String ACTION_STOP = "app.nearboard.app.STOP_MESH";

    private static final String CHANNEL_ID = "nearboard_mesh";
    private static final int NOTIFICATION_ID = 1;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopSelf();
            return START_NOT_STICKY;
        }

        Notification notification = buildNotification();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            // API 34 requires the type to be declared, and connectedDevice is
            // the honest one — this service exists to talk to nearby devices.
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
            );
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // START_STICKY: if Android reclaims the process under memory pressure,
        // the mesh should come back rather than silently staying dead.
        return START_STICKY;
    }

    private Notification buildNotification() {
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPending = PendingIntent.getActivity(
            this, 0, openApp,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Intent stop = new Intent(this, MeshForegroundService.class);
        stop.setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(
            this, 1, stop,
            PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT
        );

        Notification.Builder builder =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        return builder
            .setContentTitle("nearboard is listening nearby")
            .setContentText("Posts can reach you while the app is closed")
            .setSmallIcon(android.R.drawable.stat_notify_sync)
            .setContentIntent(openPending)
            .setOngoing(true)
            // An action, so the notification is something the user can act on
            // rather than merely endure.
            .addAction(new Notification.Action.Builder(
                null, "Stop", stopPending
            ).build())
            .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;

        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Mesh",
            // Low: present in the shade, but it must never make a sound or
            // interrupt. This notification is a status line, not an alert.
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Keeps nearboard reachable while the app is closed");
        channel.setShowBadge(false);

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null; // Started, not bound.
    }

    // ---- helpers for the plugin ----

    public static void start(Context context) {
        Intent intent = new Intent(context, MeshForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            context.startForegroundService(intent);
        } else {
            context.startService(intent);
        }
    }

    public static void stop(Context context) {
        context.stopService(new Intent(context, MeshForegroundService.class));
    }
}
