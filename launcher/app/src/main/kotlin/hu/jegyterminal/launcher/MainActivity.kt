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
import android.webkit.*
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.Toast
import org.json.JSONObject

/**
 * Jegyterminál launcher: kezdőképernyőként a jegyellenőr web-app fut teljes képernyőn.
 *  - alsó fogantyú / felhúzás: alkalmazás-fiók (Google, Chrome, Beállítások… minden telepített app)
 *  - fogantyú hosszan: beállítások (URL, PIN, kioszk)
 *  - Zebra DataWedge: a szkenner közvetlenül a web-appba küldi a kódot (window.jegyScan)
 *  - ha az app "device owner" (adb dpm set-device-owner), Lock Task kioszk módban fut
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null
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
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)
        web = findViewById(R.id.web)
        setupWeb()
        findViewById<View>(R.id.retry).setOnClickListener { findViewById<View>(R.id.offline).visibility = View.GONE; web.loadUrl(url) }
        findViewById<View>(R.id.offlineSettings).setOnClickListener { askPin { showSettings() } }
        val handle = findViewById<View>(R.id.handle)
        handle.setOnLongClickListener { askPin { showSettings() }; true }
        val gd = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onFling(e1: MotionEvent?, e2: MotionEvent, vx: Float, vy: Float): Boolean {
                val h = resources.displayMetrics.heightPixels
                if (e1 != null && e1.y > h * 0.9f && vy < -1200 && e1.y - e2.y > 120) { openDrawer(); return true }
                return false
            }
        })
        findViewById<View>(R.id.root).setOnTouchListener { _, ev -> gd.onTouchEvent(ev); false }
        web.setOnTouchListener { _, ev -> gd.onTouchEvent(ev); false }
        if (android.os.Build.VERSION.SDK_INT >= 23 && checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(arrayOf(Manifest.permission.CAMERA), 1)
        setupDataWedge()
        web.loadUrl(url)
    }

    private fun setupWeb() {
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.mediaPlaybackRequiresUserGesture = false
        s.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW   // https oldal → http LAN szerver
        s.allowFileAccess = true
        s.loadWithOverviewMode = true
        s.useWideViewPort = true
        s.setSupportZoom(false)
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.userAgentString = s.userAgentString + " JegyTerminalLauncher/1.0"
        web.setBackgroundColor(0xFF4A148C.toInt())
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) { runOnUiThread { request.grant(request.resources) } }
            override fun onShowFileChooser(w: WebView?, cb: ValueCallback<Array<Uri>>, p: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                val i = Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE).setType("image/*")
                try { startActivityForResult(Intent.createChooser(i, "Kép"), 7) } catch (e: Exception) { fileCb = null; return false }
                return true
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(v: WebView, r: WebResourceRequest): Boolean {
                val u = r.url.toString()
                if (u.startsWith("http")) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, r.url)) } catch (e: Exception) {}
                return true
            }
            override fun onReceivedError(v: WebView, r: WebResourceRequest, e: WebResourceError) {
                if (r.isForMainFrame) {
                    findViewById<View>(R.id.offline).visibility = View.VISIBLE
                    findViewById<android.widget.TextView>(R.id.offlineMsg).text = "A terminál oldala nem tölthető be (${e.description}).\nEllenőrizd a Wi-Fi / mobilnet kapcsolatot, vagy a címet a beállításokban."
                }
            }
            override fun onPageFinished(v: WebView, u: String) { findViewById<View>(R.id.offline).visibility = View.GONE }
        }
    }

    /** Zebra DataWedge profil: a szkenner Intenttel küldi a kódot ennek az appnak (billentyűzet-mód kikapcsolva). */
    private fun setupDataWedge() {
        try {
            val app = Bundle().apply { putString("PACKAGE_NAME", packageName); putStringArray("ACTIVITY_LIST", arrayOf("*")) }
            val barcode = Bundle().apply {
                putString("PLUGIN_NAME", "BARCODE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply {
                    putString("scanner_selection", "auto"); putString("scanner_input_enabled", "true")
                    putString("decoder_qrcode", "true"); putString("decoder_datamatrix", "true"); putString("decoder_pdf417", "true"); putString("decoder_code128", "true"); putString("decoder_aztec", "true")
                })
            }
            val intentOut = Bundle().apply {
                putString("PLUGIN_NAME", "INTENT"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("intent_output_enabled", "true"); putString("intent_action", SCAN_ACTION); putString("intent_delivery", "2") })
            }
            val keys = Bundle().apply {
                putString("PLUGIN_NAME", "KEYSTROKE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply { putString("keystroke_output_enabled", "false") })
            }
            val profile = Bundle().apply {
                putString("PROFILE_NAME", "JegyTerminal"); putString("PROFILE_ENABLED", "true"); putString("CONFIG_MODE", "CREATE_IF_NOT_EXIST")
                putParcelableArray("APP_LIST", arrayOf(app))
                putParcelableArrayList("PLUGIN_CONFIG", arrayListOf(barcode, intentOut, keys))
            }
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", profile))
        } catch (e: Exception) { /* nem Zebra eszköz */ }
    }

    private fun inject(code: String) {
        val js = "(function(c){ if(window.jegyScan){ window.jegyScan(c); } else { var i=document.getElementById('codeInput'); if(i){ i.value=c; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); } } })(" + JSONObject.quote(code) + ")"
        runOnUiThread { web.evaluateJavascript(js, null) }
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
        AlertDialog.Builder(this).setTitle("Jegyterminál launcher").setView(lay)
            .setMessage(if (owner) "Kioszk mód: AKTÍV (device owner)" else "Kioszk mód: nincs (adb: dpm set-device-owner hu.jegyterminal.launcher/.AdminReceiver)")
            .setPositiveButton("Mentés") { _, _ ->
                prefs.edit().putString("url", eu.text.toString().trim()).apply()
                if (ep.text.isNotBlank()) prefs.edit().putString("pin", ep.text.toString().trim()).apply()
                web.loadUrl(url)
            }
            .setNeutralButton("Újratöltés") { _, _ -> web.clearCache(true); web.loadUrl(url) }
            .setNegativeButton(if (owner) "Kioszk feloldása" else "Mégse") { _, _ -> if (owner) try { stopLockTask() } catch (e: Exception) {} }
            .show()
    }

    override fun onResume() {
        super.onResume()
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(scanRx, IntentFilter(SCAN_ACTION), RECEIVER_EXPORTED) else registerReceiver(scanRx, IntentFilter(SCAN_ACTION))
        window.decorView.systemUiVisibility = (View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_LAYOUT_STABLE)
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

    override fun onActivityResult(req: Int, res: Int, data: Intent?) {
        super.onActivityResult(req, res, data)
        if (req == 7) { val u = if (res == RESULT_OK) data?.data else null; fileCb?.onReceiveValue(if (u != null) arrayOf(u) else null); fileCb = null }
    }

    override fun onBackPressed() { /* a terminálból nincs kilépés a Vissza gombbal */ }

    override fun dispatchKeyEvent(e: KeyEvent): Boolean {
        // Zebra: oldalsó szkenner-gombok és Enter a web-apphoz mennek; Home-ot a rendszer kezeli (mi vagyunk a Home)
        return super.dispatchKeyEvent(e)
    }

    companion object { const val SCAN_ACTION = "hu.jegyterminal.SCAN" }
}
