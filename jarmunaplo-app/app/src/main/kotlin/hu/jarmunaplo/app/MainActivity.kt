package hu.jarmunaplo.app

import android.annotation.SuppressLint
import android.app.Activity
import android.content.BroadcastReceiver
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject
import java.io.File

/**
 * Járműnapló: a web-app (GitHub Pages) teljes képernyőn, saját appként.
 * - Fotó: kamera vagy galéria a jegyzetkönyvhöz.
 * - Kulcs: a web-app a vágólapról be tudja illeszteni (JarmuNative.paste).
 * - Zebra DataWedge: a beolvasott kód a web-app window.jegyScan függvényéhez megy (keresés).
 */
class MainActivity : Activity() {
    private lateinit var web: WebView
    private lateinit var offline: LinearLayout
    private var failed = false
    private var pending: String? = null
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private var camUri: Uri? = null
    private val url get() = getString(R.string.app_url)

    private val scanRx = object : BroadcastReceiver() {
        override fun onReceive(c: Context?, i: Intent?) {
            val code = i?.getStringExtra("com.symbol.datawedge.data_string") ?: return
            inject(code)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        web = WebView(this)
        web.setBackgroundColor(Color.parseColor("#F4F2F7"))
        val s = web.settings
        s.javaScriptEnabled = true
        s.domStorageEnabled = true
        s.databaseEnabled = true
        s.allowFileAccess = false
        s.mediaPlaybackRequiresUserGesture = false
        s.cacheMode = WebSettings.LOAD_DEFAULT
        s.userAgentString = s.userAgentString + " JarmunaploApp/1.0"
        web.addJavascriptInterface(object {
            @JavascriptInterface
            fun paste(): String {
                return try {
                    val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    val clip = cm.primaryClip
                    if (clip != null && clip.itemCount > 0) clip.getItemAt(0).coerceToText(this@MainActivity).toString().take(200) else ""
                } catch (e: Exception) { "" }
            }
        }, "JarmuNative")

        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url.toString()
                if (u.startsWith(url)) return false
                try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (e: Exception) {}
                return true
            }
            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (request.isForMainFrame) { failed = true; offline.visibility = View.VISIBLE }
            }
            override fun onPageFinished(view: WebView, u: String) {
                if (!failed) offline.visibility = View.GONE
                pending?.let { pending = null; web.postDelayed({ inject(it) }, 400) }
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null)
                fileCb = cb
                val pick = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"; addCategory(Intent.CATEGORY_OPENABLE)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                }
                val extras = ArrayList<Intent>()
                try {
                    val name = "foto_" + System.currentTimeMillis() + ".jpg"
                    File(cacheDir, "photos").mkdirs()
                    val u = Uri.parse("content://hu.jarmunaplo.app.photos/" + name)
                    val cam = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                        putExtra(MediaStore.EXTRA_OUTPUT, u)
                        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION or Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    }
                    if (cam.resolveActivity(packageManager) != null) { camUri = u; extras.add(cam) }
                } catch (e: Exception) {}
                val chooser = Intent.createChooser(pick, "Fotó")
                if (extras.isNotEmpty()) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, extras.toTypedArray())
                return try { startActivityForResult(chooser, REQ_FILE); true } catch (e: Exception) { fileCb = null; false }
            }
        }

        offline = LinearLayout(this)
        offline.orientation = LinearLayout.VERTICAL
        offline.gravity = Gravity.CENTER
        offline.setBackgroundColor(Color.parseColor("#4A148C"))
        offline.setPadding(48, 48, 48, 48)
        offline.visibility = View.GONE
        val msg = TextView(this)
        msg.text = "Nincs internet.\nAz első indításhoz internet kell, utána az app anélkül is megnyílik."
        msg.setTextColor(Color.WHITE)
        msg.textSize = 18f
        msg.gravity = Gravity.CENTER
        val retry = Button(this)
        retry.text = "Újra"
        retry.setOnClickListener { load() }
        offline.addView(msg)
        offline.addView(retry)

        val root = FrameLayout(this)
        root.addView(web, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        root.addView(offline, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        setContentView(root)

        setupDataWedge()
        intent?.getStringExtra("com.symbol.datawedge.data_string")?.let { pending = it }
        load()
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_FILE) return
        val cb = fileCb ?: return
        fileCb = null
        var result: Array<Uri>? = null
        if (resultCode == RESULT_OK) {
            val list = ArrayList<Uri>()
            val clip = data?.clipData
            if (clip != null) for (i in 0 until clip.itemCount) list.add(clip.getItemAt(i).uri)
            else data?.data?.let { list.add(it) }
            if (list.isEmpty()) camUri?.let { u ->
                val f = File(File(cacheDir, "photos"), u.lastPathSegment ?: "")
                if (f.exists() && f.length() > 0) list.add(u)
            }
            if (list.isNotEmpty()) result = list.toTypedArray()
        }
        camUri = null
        cb.onReceiveValue(result)
    }

    private fun load() {
        failed = false
        offline.visibility = View.GONE
        web.loadUrl(url)
    }

    private fun inject(code: String) {
        val js = "(function(c){if(typeof window.jegyScan==='function'){window.jegyScan(c);return 1}return 0})(" + JSONObject.quote(code) + ")"
        runOnUiThread {
            try { web.evaluateJavascript(js) { r -> if (r != "1") pending = code } } catch (e: Exception) { pending = code }
        }
    }

    /** Zebra DataWedge profil: Intent kimenet be, billentyű-kimenet ki. Nem Zebra készüléken nem csinál semmit. */
    private fun setupDataWedge() {
        try {
            val app = Bundle().apply { putString("PACKAGE_NAME", packageName); putStringArray("ACTIVITY_LIST", arrayOf("*")) }
            fun cfg(plugin: Bundle, mode: String = "CREATE_IF_NOT_EXIST") = Bundle().apply {
                putString("PROFILE_NAME", PROFILE); putString("PROFILE_ENABLED", "true"); putString("CONFIG_MODE", mode)
                putParcelableArray("APP_LIST", arrayOf(app)); putBundle("PLUGIN_CONFIG", plugin)
            }
            val barcode = Bundle().apply {
                putString("PLUGIN_NAME", "BARCODE"); putString("RESET_CONFIG", "true")
                putBundle("PARAM_LIST", Bundle().apply {
                    putString("scanner_selection", "auto"); putString("scanner_input_enabled", "true")
                    putString("decoder_code128", "true"); putString("decoder_code39", "true"); putString("decoder_i2of5", "true")
                    putString("decoder_qrcode", "true"); putString("decoder_datamatrix", "true"); putString("decoder_pdf417", "true")
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
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(barcode)))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(intentOut, "UPDATE")))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SET_CONFIG", cfg(keys, "UPDATE")))
            sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SWITCH_TO_PROFILE", PROFILE))
        } catch (e: Exception) { /* nem Zebra eszköz */ }
    }

    override fun onResume() {
        super.onResume()
        if (android.os.Build.VERSION.SDK_INT >= 33) registerReceiver(scanRx, IntentFilter(SCAN_ACTION), RECEIVER_EXPORTED) else registerReceiver(scanRx, IntentFilter(SCAN_ACTION))
        try { sendBroadcast(Intent("com.symbol.datawedge.api.ACTION").putExtra("com.symbol.datawedge.api.SWITCH_TO_PROFILE", PROFILE)) } catch (e: Exception) {}
        web.onResume()
    }

    override fun onPause() {
        super.onPause()
        try { unregisterReceiver(scanRx) } catch (e: Exception) {}
        web.onPause()
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        intent?.getStringExtra("com.symbol.datawedge.data_string")?.let { inject(it) }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    companion object {
        const val REQ_FILE = 41
        const val SCAN_ACTION = "hu.jarmunaplo.SCAN"
        const val PROFILE = "Jarmunaplo"
    }
}
