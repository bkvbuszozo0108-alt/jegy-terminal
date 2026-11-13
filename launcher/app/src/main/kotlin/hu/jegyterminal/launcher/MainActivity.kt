package hu.jegyterminal.launcher

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.*
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.*
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import org.json.JSONObject
import org.mozilla.geckoview.*

/**
 * Jegyterminál launcher: kezdőképernyőként a jegyellenőr web-app fut teljes képernyőn.
 * A web-appot NEM a rendszer (sokszor elavult) WebView-ja, hanem a beépített GeckoView (Firefox-motor) futtatja,
 * így Android 5–7-es, Play Áruház nélküli készülékeken (pl. Zebra TC56) is megy.
 *  - alkalmazás-fiók (minden telepített app): csak a beállításokból
 *  - alul középen hosszan: beállítások (URL, PIN, kioszk)
 *  - Zebra DataWedge: a szkenner Intenttel küldi a kódot → a beépített kiegészítőn át a web-appnak (window.jegyScan)
 *  - ha az app "device owner" (adb dpm set-device-owner), Lock Task kioszk módban fut
 */
class MainActivity : Activity() {
    private lateinit var gv: GeckoView
    private lateinit var session: GeckoSession
    private var port: WebExtension.Port? = null
    private var pendingScan: String? = null
    private var permCb: GeckoSession.PermissionDelegate.Callback? = null
    private val prefs by lazy { getSharedPreferences("jt", MODE_PRIVATE) }
    private val url get() = prefs.getString("url", getString(R.string.default_url))!!
    private val pin get() = prefs.getString("pin", getString(R.string.default_pin))!!

    private val scanRx = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            val code = i?.getStringExtra("com.symbol.datawedge.data_string") ?: return
            inject(code)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON or WindowManager.LayoutParams.FLAG_FULLSCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS)
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        setContentView(R.layout.activity_main)
        gv = findViewById(R.id.web)
        setupGecko()
        findViewById<View>(R.id.retry).setOnClickListener { findViewById<View>(R.id.offline).visibility = View.GONE; session.loadUri(url) }
        findViewById<View>(R.id.offlineSettings).setOnClickListener { askPin { showSettings() } }
        findViewById<View>(R.id.handle).setOnLongClickListener { askPin { showSettings() }; true }
        if (android.os.Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
        setupDataWedge()
        session.loadUri(url)
    }

    private val gd by lazy {
        GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                val h = resources.displayMetrics.heightPixels
                if (e1 != null && e1.y > h * 0.9f && vy < -1200 && e1.y - e2.y > 120) { openDrawer(); return true }
                return false
            }
        })
    }

    /* nincs felhúzó gesztus – az alkalmazás-lista csak a beállításokból nyitható (a Zebrán a gesztus zavarta a terminált) */

    private fun setupGecko() {
        val rt = runtime(this)
        val ua = "Mozilla/5.0 (Android " + android.os.Build.VERSION.RELEASE + "; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0 JegyTerminalLauncher/" + BuildConfig.VERSION_NAME + (if (hwMode()) " Zebra" else "")
        session = GeckoSession(GeckoSessionSettings.Builder().usePrivateMode(false).userAgentOverride(ua).build())
        session.permissionDelegate = object : GeckoSession.PermissionDelegate {
            override fun onAndroidPermissionsRequest(s: GeckoSession, permissions: Array<out String>?, callback: GeckoSession.PermissionDelegate.Callback) {
                if (android.os.Build.VERSION.SDK_INT < 23 || permissions == null || permissions.all { checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED }) { callback.grant(); return }
                permCb = callback; requestPermissions(permissions, 2)
            }
            override fun onContentPermissionRequest(s: GeckoSession, perm: GeckoSession.PermissionDelegate.ContentPermission): GeckoResult<Int> =
                GeckoResult.fromValue(GeckoSession.PermissionDelegate.ContentPermission.VALUE_ALLOW)
            override fun onMediaPermissionRequest(s: GeckoSession, uri: String, video: Array<out GeckoSession.PermissionDelegate.MediaSource>?, audio: Array<out GeckoSession.PermissionDelegate.MediaSource>?, callback: GeckoSession.PermissionDelegate.MediaCallback) {
                val cam = video?.firstOrNull { it.source == GeckoSession.PermissionDelegate.MediaSource.SOURCE_CAMERA && (it.name ?: "").lowercase().let { n -> n.contains("back") || n.contains("rear") || n.contains("environment") } }
                    ?: video?.firstOrNull { it.source == GeckoSession.PermissionDelegate.MediaSource.SOURCE_CAMERA } ?: video?.firstOrNull()
                if (cam != null) callback.grant(cam, null) else callback.reject()
            }
        }
        session.navigationDelegate = object : GeckoSession.NavigationDelegate {
            override fun onLoadRequest(s: GeckoSession, r: GeckoSession.NavigationDelegate.LoadRequest): GeckoResult<AllowOrDeny> {
                if (r.uri.startsWith("http")) return GeckoResult.fromValue(AllowOrDeny.ALLOW)
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(r.uri))) } catch (e: Exception) {}
                return GeckoResult.fromValue(AllowOrDeny.DENY)
            }
            override fun onNewSession(s: GeckoSession, uri: String): GeckoResult<GeckoSession> { s.loadUri(uri); val r = GeckoResult<GeckoSession>(); r.complete(null); return r }
        }
        session.progressDelegate = object : GeckoSession.ProgressDelegate {
            override fun onPageStop(s: GeckoSession, success: Boolean) {
                findViewById<View>(R.id.offline).visibility = if (success) View.GONE else View.VISIBLE
                if (!success) findViewById<android.widget.TextView>(R.id.offlineMsg).text = "A terminál oldala nem tölthető be.\nEllenőrizd a Wi-Fi / mobilnet kapcsolatot, vagy a címet a beállításokban."
            }
        }
        session.contentDelegate = object : GeckoSession.ContentDelegate {
            override fun onExternalResponse(s: GeckoSession, response: WebResponse) {
                val uri = response.uri
                if (!uri.endsWith(".apk")) return
                Toast.makeText(this@MainActivity, "Frissítés letöltése… (kb. 1 perc)", Toast.LENGTH_LONG).show()
                Thread {
                    try {
                        val f = java.io.File(getExternalFilesDir(null), "update.apk"); if (f.exists()) f.delete()
                        response.body?.use { inp -> java.io.FileOutputStream(f).use { out -> inp.copyTo(out, 1 shl 16) } }
                        runOnUiThread { installApk(f) }
                    } catch (e: Exception) { runOnUiThread { Toast.makeText(this@MainActivity, "Letöltési hiba: " + e.message, Toast.LENGTH_LONG).show() } }
                }.start()
            }
            override fun onCrash(s: GeckoSession) { s.close(); setupGecko(); session.loadUri(url) }
            override fun onKill(s: GeckoSession) { s.close(); setupGecko(); session.loadUri(url) }
        }
        session.open(rt)
        gv.setSession(session)
        // beépített kiegészítő: ezen át jut el a szkennelt kód a web-appnak
        rt.webExtensionController.ensureBuiltIn("resource://android/assets/jtext/", "jt@jegyterminal").accept({ ext ->
            if (ext != null) session.webExtensionController.setMessageDelegate(ext, object : WebExtension.MessageDelegate {
                override fun onConnect(p: WebExtension.Port) {
                    port = p
                    p.setDelegate(object : WebExtension.PortDelegate {
                        override fun onDisconnect(pp: WebExtension.Port) { if (port == pp) port = null }
                        override fun onPortMessage(m: Any, pp: WebExtension.Port) { if (m is JSONObject) { if (m.optBoolean("trigger")) softScan(true); if (m.optBoolean("update")) runOnUiThread { startUpdate() } } }
                    })
                    try { p.postMessage(JSONObject().put("hw", hwMode()).put("dev", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)) } catch (e: Exception) {}
                    pendingScan?.let { inject(it) }; pendingScan = null
                }
            }, "jt")
        }, { })
    }

    override fun onRequestPermissionsResult(req: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(req, permissions, results)
        if (req == 2) { val cb = permCb; permCb = null; if (results.all { it == PackageManager.PERMISSION_GRANTED }) cb?.grant() else cb?.reject() }
    }

    /** Zebra DataWedge profil – pluginonként külön üzenettel (a régi, 6.x DataWedge csak így fogadja), majd bekapcsolás és profilváltás. */
    private fun setupDataWedge() {
        try {
            val app = Bundle().apply { putString("PACKAGE_NAME", packageName); putStringArray("ACTIVITY_LIST", arrayOf("*")) }
            fun cfg(plugin: Bundle, mode: String = "CREATE_IF_NOT_EXIST") = Bundle().apply {
                putString("PROFILE_NAME", "JegyTerminal"); putString("PROFILE_ENABLED", "true"); putString("CONFIG_MODE", mode)
                putParcelableArray("APP_LIST", arrayOf(app)); putBundle("PLUGIN_CONFIG", plugin)
            }
            val barcode = Bundle().apply {
                putString("PLUGIN_NAME", "BARCODE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply {
                    putString("scanner_selection", "auto"); putString("scanner_input_enabled", "true"); putString("aim_type", "0"); putString("illumination_mode", "torch")
                    putString("decoder_qrcode", "true"); putString("decoder_datamatrix", "true"); putString("decoder_pdf417", "true"); putString("decoder_code128", "true"); putString("decoder_aztec", "true")
                    putString("decoder_ean13", "true"); putString("decoder_ean8", "true"); putString("decoder_code39", "true"); putString("decoder_i2of5", "true"); putString("decoder_upca", "true"); putString("decoder_micropdf", "true")
                })
            }
            val intentOut = Bundle().apply {
                putString("PLUGIN_NAME", "INTENT"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("intent_output_enabled", "true"); putString("intent_action", SCAN_ACTION); putString("intent_delivery", "2") })
            }
            val keys = Bundle().apply {
                putString("PLUGIN_NAME", "KEYSTROKE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("keystroke_output_enabled", "true"); putString("keystroke_action_char", "13"); putString("keystroke_delay_extended_ascii", "0") })
            }
            dw("com.symbol.datawedge.api.ENABLE_DATAWEDGE", true)
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION_ENABLEDATAWEDGE").putExtra("com.symbol.datawedge.api.EXTRA_PARAMETER", true))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(barcode)))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(intentOut, "UPDATE")))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(keys, "UPDATE")))
            dw("com.symbol.datawedge.api.SWITCH_TO_PROFILE", "JegyTerminal")
            dw("com.symbol.datawedge.api.SCANNER_INPUT_PLUGIN", "ENABLE_PLUGIN")
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION_SCANNERINPUTPLUGIN").putExtra("com.symbol.datawedge.api.EXTRA_PARAMETER", "ENABLE_PLUGIN"))
        } catch (e: Exception) { /* nem Zebra eszköz */ }
    }
    private fun dw(key: String, value: Any) {
        val i = Intent("com.symbol.datawedge.api.ACTION")
        when (value) { is Boolean -> i.putExtra(key, value); else -> i.putExtra(key, value.toString()) }
        sendBroadcast(i)
    }
    /** Szkennelés indítása programból (a terminál szkenner-paneljére koppintva vagy a tanított gombbal). */
    private fun softScan(start: Boolean) {
        val p = if (start) "START_SCANNING" else "STOP_SCANNING"
        dw("com.symbol.datawedge.api.SOFT_SCAN_TRIGGER", p)
        sendBroadcast(Intent("com.symbol.datawedge.api.ACTION_SOFTSCANTRIGGER").putExtra("com.symbol.datawedge.api.EXTRA_PARAMETER", p))
    }
    private val scanKeys get() = prefs.getStringSet("scanKeys", null) ?: setOf("102", "103", "280", "281", "106", "107", "290")
    private var learnKey: ((Int) -> Unit)? = null
    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        learnKey?.let { if (e.action == KeyEvent.ACTION_DOWN) { it(e.keyCode); learnKey = null }; return true }
        if (scanKeys.contains(e.keyCode.toString())) {
            if (e.action == KeyEvent.ACTION_DOWN && e.repeatCount == 0) softScan(true)
            return true
        }
        return super.dispatchKeyEvent(e)
    }

    private fun inject(code: String) {
        val p = port
        if (p == null) { pendingScan = code; return }
        runOnUiThread { try { p.postMessage(JSONObject().put("code", code)) } catch (e: Exception) { pendingScan = code } }
    }

    /** Az új APK letöltése a GitHub kiadásból és a telepítő megnyitása – kábel nélkül. */
    private var dlId = -1L
    private val dlRx = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            if (i?.getLongExtra(android.app.DownloadManager.EXTRA_DOWNLOAD_ID, -1) != dlId) return
            try { unregisterReceiver(this) } catch (e: Exception) {}
            val f = java.io.File(getExternalFilesDir(null), "update.apk")
            installApk(f)
        }
    }
    private fun installApk(f: java.io.File) {
        if (!f.exists() || f.length() < 1_000_000) { Toast.makeText(this, "A letöltés nem sikerült", Toast.LENGTH_LONG).show(); return }
        try {
            val it = Intent(Intent.ACTION_VIEW)
            if (android.os.Build.VERSION.SDK_INT >= 24) {
                val u = androidx.core.content.FileProvider.getUriForFile(this, "hu.jegyterminal.launcher.files", f)
                it.setDataAndType(u, "application/vnd.android.package-archive"); it.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            } else it.setDataAndType(Uri.fromFile(f), "application/vnd.android.package-archive")
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try { stopLockTask() } catch (e: Exception) {}
            startActivity(it)
        } catch (e: Exception) { Toast.makeText(this, "Telepítő nem nyitható: " + e.message, Toast.LENGTH_LONG).show() }
    }
    private fun startUpdate() {
        val url = if (android.os.Build.SUPPORTED_ABIS.firstOrNull() == "armeabi-v7a") APK_URL_ZEBRA else APK_URL
        session.loadUri(url + "?t=" + System.currentTimeMillis())   // a beépített motor tölti le → onExternalResponse → telepítő
    }

    private fun openDrawer() { startActivity(Intent(this, DrawerActivity::class.java)); overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out) }

    private fun askPin(ok: () -> Unit) {
        val e = EditText(this).apply { inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD; hint = "PIN" }
        AlertDialog.Builder(this).setTitle("Beállítások").setView(e)
            .setPositiveButton("OK") { _, _ -> if (e.text.toString() == pin) ok() else Toast.makeText(this, "Hibás PIN", Toast.LENGTH_SHORT).show() }
            .setNegativeButton("Mégse", null).show()
    }

    private fun showSettings() {
        val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
        val owner = dpm.isDeviceOwnerApp(packageName)
        val lay = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40, 20, 40, 0) }
        val eu = EditText(this).apply { hint = "Terminál címe (URL)"; setText(url); inputType = InputType.TYPE_TEXT_VARIATION_URI }
        val ep = EditText(this).apply { hint = "Új PIN (üres = marad)"; inputType = InputType.TYPE_CLASS_NUMBER }
        lay.addView(eu); lay.addView(ep)
        val hw = android.widget.Spinner(this); val hwOpts = listOf("auto" to "Szkenner: automatikus (Zebrán beépített, máshol kamera)", "on" to "Szkenner: mindig a beépített", "off" to "Szkenner: mindig kamera")
        hw.adapter = android.widget.ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, hwOpts.map { it.second }); hw.setSelection(hwOpts.indexOfFirst { it.first == prefs.getString("hw", "auto") }.coerceAtLeast(0))
        lay.addView(hw)
        fun btn(t: String, f: () -> Unit) = android.widget.Button(this).apply { text = t; setOnClickListener { f() } }
        lay.addView(btn("Szkenner beállítása újra (DataWedge profil)") { setupDataWedge(); Toast.makeText(this, "DataWedge profil elküldve", Toast.LENGTH_SHORT).show() })
        lay.addView(btn("Próba-szkennelés (lézer)") { softScan(true) })
        lay.addView(btn("Szkenner-gomb tanítása (" + scanKeys.joinToString(",") + ")") {
            val d = AlertDialog.Builder(this).setTitle("Nyomd meg a szkenner gombját…").setMessage("Ha a gomb lenyomására semmi nem történik, azt a DataWedge kezeli – akkor a „Szkenner beállítása újra” gombot használd.").setNegativeButton("Mégse") { _, _ -> learnKey = null }.create()
            val save: (Int) -> Unit = { code -> learnKey = null; prefs.edit().putStringSet("scanKeys", scanKeys + code.toString()).apply(); try { d.dismiss() } catch (e: Exception) {}; Toast.makeText(this, "Gomb mentve: $code", Toast.LENGTH_SHORT).show() }
            d.setOnKeyListener { _, code, ev -> if (ev.action == KeyEvent.ACTION_DOWN && code != KeyEvent.KEYCODE_BACK) { save(code); true } else false }
            learnKey = save; d.show()
        })
        lay.addView(btn("Gomb-tanítás törlése") { prefs.edit().remove("scanKeys").apply(); Toast.makeText(this, "Alap gombok", Toast.LENGTH_SHORT).show() })
        lay.addView(btn("Launcher frissítése (letöltés + telepítés)") { startUpdate() })
        lay.addView(btn("Alkalmazások megnyitása (Google, Chrome…)") { openDrawer() })
        lay.addView(btn("DataWedge app megnyitása") { try { startActivity(packageManager.getLaunchIntentForPackage("com.symbol.datawedge")) } catch (e: Exception) { Toast.makeText(this, "Nincs DataWedge ezen a készüléken", Toast.LENGTH_SHORT).show() } })
        val sv = android.widget.ScrollView(this); sv.addView(lay)
        AlertDialog.Builder(this).setTitle("Jegyterminál launcher").setView(sv)
            .setMessage(if (owner) "Kioszk mód: AKTÍV (device owner)" else "Kioszk mód: nincs (adb: dpm set-device-owner hu.jegyterminal.launcher/.AdminReceiver)")
            .setPositiveButton("Mentés") { _, _ ->
                prefs.edit().putString("url", eu.text.toString().trim()).putString("hw", hwOpts[hw.selectedItemPosition].first).apply()
                if (ep.text.isNotBlank()) prefs.edit().putString("pin", ep.text.toString().trim()).apply()
                session.close(); setupGecko(); session.loadUri(url)
            }
            .setNeutralButton("Újratöltés") { _, _ -> session.reload(GeckoSession.LOAD_FLAGS_BYPASS_CACHE) }
            .setNegativeButton(if (owner) "Kioszk feloldása" else "Mégse") { _, _ -> if (owner) try { stopLockTask() } catch (e: Exception) {} }
            .show()
    }

    override fun onResume() {
        super.onResume()
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(scanRx, IntentFilter(SCAN_ACTION), RECEIVER_EXPORTED) else registerReceiver(scanRx, IntentFilter(SCAN_ACTION))
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN)
        try {
            val dpm = getSystemService(DEVICE_POLICY_SERVICE) as DevicePolicyManager
            if (dpm.isDeviceOwnerApp(packageName)) {
                val admin = ComponentName(this, AdminReceiver::class.java)
                val pkgs = packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0).map { it.activityInfo.packageName }.toMutableSet()
                pkgs.add(packageName)
                dpm.setLockTaskPackages(admin, pkgs.toTypedArray())
                startLockTask()
            }
        } catch (e: Exception) {}
    }

    override fun onPause() { super.onPause(); try { unregisterReceiver(scanRx) } catch (e: Exception) {} }

    override fun onNewIntent(intent: Intent?) { super.onNewIntent(intent); intent?.getStringExtra("com.symbol.datawedge.data_string")?.let { inject(it) } }

    override fun onBackPressed() { /* a terminálból nincs kilépés a Vissza gombbal */ }

    /** beépített szkenner: "auto" = Zebrán igen, máshol kamera; "on" / "off" kézi */
    private fun hwMode(): Boolean = when (prefs.getString("hw", "auto")) { "on" -> true; "off" -> false; else -> isZebra() }

    /** Zebra / Symbol / Motorola Solutions készülék (beépített vonalkódolvasóval)? */
    private fun isZebra(): Boolean { val m = (android.os.Build.MANUFACTURER + " " + android.os.Build.BRAND).lowercase(); return m.contains("zebra") || m.contains("symbol") || m.contains("motorola solutions") || packageManager.getLaunchIntentForPackage("com.symbol.datawedge") != null }

    companion object {
        const val SCAN_ACTION = "hu.jegyterminal.SCAN"
        const val APK_URL_ZEBRA = "https://bkvbuszozo0108-alt.github.io/jegy-terminal/apk/jegyterminal-launcher-zebra.apk"
        const val APK_URL = "https://github.com/bkvbuszozo0108-alt/jegy-terminal/releases/download/launcher/jegyterminal-launcher.apk"
        private var rt: GeckoRuntime? = null
        fun runtime(ctx: Context): GeckoRuntime {
            rt?.let { return it }
            val s = GeckoRuntimeSettings.Builder().javaScriptEnabled(true).remoteDebuggingEnabled(false).consoleOutput(false).build()
            return GeckoRuntime.create(ctx.applicationContext, s).also { rt = it }
        }
    }
}
