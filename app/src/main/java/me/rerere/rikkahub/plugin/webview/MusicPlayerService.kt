package me.rerere.rikkahub.plugin.webview

import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import me.rerere.rikkahub.MUSIC_PLAYER_NOTIFICATION_CHANNEL_ID
import me.rerere.rikkahub.R
import java.io.File
import java.io.IOException

private const val TAG = "MusicPlayerService"
private const val NOTIFICATION_ID = 2001

private const val ACTION_PLAY = "me.rerere.rikkahub.MUSIC_PLAY"
private const val ACTION_PAUSE = "me.rerere.rikkahub.MUSIC_PAUSE"
private const val ACTION_RESUME = "me.rerere.rikkahub.MUSIC_RESUME"
private const val ACTION_STOP = "me.rerere.rikkahub.MUSIC_STOP"
private const val EXTRA_FILE_PATH = "filePath"
private const val EXTRA_TITLE = "title"
private const val EXTRA_ARTIST = "artist"

class MusicPlayerService : Service() {

    companion object {
        private var mediaPlayer: MediaPlayer? = null
        private var currentState: Int = STATE_STOPPED
        private var currentTitle: String = ""
        private var currentArtist: String = ""
        private var currentFilePath: String = ""

        private const val STATE_PLAYING = 1
        private const val STATE_PAUSED = 2
        private const val STATE_STOPPED = 3

        fun play(context: Context, filePath: String, title: String, artist: String) {
            val intent = Intent(context, MusicPlayerService::class.java).apply {
                action = ACTION_PLAY
                putExtra(EXTRA_FILE_PATH, filePath)
                putExtra(EXTRA_TITLE, title)
                putExtra(EXTRA_ARTIST, artist)
            }
            context.startForegroundService(intent)
        }

        fun pause(context: Context) {
            val intent = Intent(context, MusicPlayerService::class.java).apply {
                action = ACTION_PAUSE
            }
            context.startService(intent)
        }

        fun resume(context: Context) {
            val intent = Intent(context, MusicPlayerService::class.java).apply {
                action = ACTION_RESUME
            }
            context.startService(intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, MusicPlayerService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }

        fun isPlaying(): Boolean = currentState == STATE_PLAYING

        fun getState(): String = when (currentState) {
            STATE_PLAYING -> "playing"
            STATE_PAUSED -> "paused"
            else -> "stopped"
        }

        fun getNowPlaying(): Map<String, String> = mapOf(
            "title" to currentTitle,
            "artist" to currentArtist,
            "filePath" to currentFilePath,
            "state" to getState()
        )
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // 必须最先调用 startForeground()，否则 Android 12+ 会抛出 ForegroundServiceStartNotAllowedException
        startForeground(NOTIFICATION_ID, buildNotification(currentTitle.ifEmpty { "Music" }, currentArtist))

        when (intent?.action) {
            ACTION_PLAY -> {
                val filePath = intent.getStringExtra(EXTRA_FILE_PATH) ?: ""
                val title = intent.getStringExtra(EXTRA_TITLE) ?: ""
                val artist = intent.getStringExtra(EXTRA_ARTIST) ?: ""
                if (filePath.isNotEmpty()) {
                    startPlayback(filePath, title, artist)
                }
            }
            ACTION_PAUSE -> pausePlayback()
            ACTION_RESUME -> resumePlayback()
            ACTION_STOP -> stopPlayback()
        }
        return START_NOT_STICKY
    }

    private fun startPlayback(filePath: String, title: String, artist: String) {
        currentTitle = title
        currentArtist = artist
        currentFilePath = filePath

        try {
            mediaPlayer?.release()
        } catch (_: Exception) {}

        mediaPlayer = MediaPlayer().apply {
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .build()
            )
            try {
                setDataSource(filePath)
                prepare()
                start()
                currentState = STATE_PLAYING
                showNotification(title, artist)
                Log.i(TAG, "Playing: $artist - $title")

                setOnCompletionListener {
                    currentState = STATE_STOPPED
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
                setOnErrorListener { _, what, extra ->
                    Log.e(TAG, "MediaPlayer error: what=$what extra=$extra")
                    currentState = STATE_STOPPED
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                    true
                }
            } catch (e: IOException) {
                Log.e(TAG, "Failed to play: ${e.message}")
                currentState = STATE_STOPPED
                stopSelf()
            }
        }
    }

    private fun pausePlayback() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) {
                    it.pause()
                    currentState = STATE_PAUSED
                    showNotification(currentTitle, currentArtist)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Pause error: ${e.message}")
        }
    }

    private fun resumePlayback() {
        try {
            mediaPlayer?.let {
                if (!it.isPlaying && currentState == STATE_PAUSED) {
                    it.start()
                    currentState = STATE_PLAYING
                    showNotification(currentTitle, currentArtist)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Resume error: ${e.message}")
        }
    }

    private fun stopPlayback() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {}
        mediaPlayer = null
        currentState = STATE_STOPPED
        currentTitle = ""
        currentArtist = ""
        currentFilePath = ""
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        try {
            mediaPlayer?.let {
                if (it.isPlaying) it.stop()
                it.release()
            }
        } catch (_: Exception) {}
        mediaPlayer = null
        currentState = STATE_STOPPED
        super.onDestroy()
    }

    private fun buildNotification(title: String, artist: String): android.app.Notification {
        val launchPendingIntent = PendingIntent.getActivity(
            this, 0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, MUSIC_PLAYER_NOTIFICATION_CHANNEL_ID)
            .setContentTitle("🎵 $title")
            .setContentText(artist)
            .setSmallIcon(R.drawable.small_icon)
            .setContentIntent(launchPendingIntent)
            .setOngoing(currentState == STATE_PLAYING)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    private fun showNotification(title: String, artist: String) {
        val notification = buildNotification(title, artist)

        if (currentState == STATE_PLAYING) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceCompat.startForeground(
                    this, NOTIFICATION_ID, notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } else {
            val nm = getSystemService(NOTIFICATION_SERVICE) as android.app.NotificationManager
            nm.notify(NOTIFICATION_ID, notification)
        }
    }
}