package hu.jegyterminal.launcher

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.BaseAdapter
import android.widget.EditText
import android.widget.GridView
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast

/** Alkalmazás-fiók: minden telepített, indítható app (Google, Chrome, Beállítások, Kamera…), mint egy normál Androidon. */
class DrawerActivity : Activity() {
    private data class App(val label: String, val pkg: String, val icon: android.graphics.drawable.Drawable)
    private var all: List<App> = emptyList()
    private var shown: List<App> = emptyList()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_drawer)
        val pm = packageManager
        all = pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0)
            .filter { it.activityInfo.packageName != packageName }
            .map { App(it.loadLabel(pm).toString(), it.activityInfo.packageName, it.loadIcon(pm)) }
            .sortedBy { it.label.lowercase() }
        shown = all
        val grid = findViewById<GridView>(R.id.grid)
        val adapter = object : BaseAdapter() {
            override fun getCount() = shown.size
            override fun getItem(i: Int) = shown[i]
            override fun getItemId(i: Int) = i.toLong()
            override fun getView(i: Int, cv: View?, parent: ViewGroup): View {
                val v = cv ?: LayoutInflater.from(this@DrawerActivity).inflate(R.layout.item_app, parent, false)
                v.findViewById<ImageView>(R.id.icon).setImageDrawable(shown[i].icon)
                v.findViewById<TextView>(R.id.label).text = shown[i].label
                return v
            }
        }
        grid.adapter = adapter
        grid.setOnItemClickListener { _, _, i, _ ->
            val li = pm.getLaunchIntentForPackage(shown[i].pkg)
            if (li != null) { startActivity(li); finish() } else Toast.makeText(this, "Nem indítható", Toast.LENGTH_SHORT).show()
        }
        grid.setOnItemLongClickListener { _, _, i, _ ->
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + shown[i].pkg))); true
        }
        val search = findViewById<EditText>(R.id.search)
        search.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                val q = s.toString().trim().lowercase()
                shown = if (q.isEmpty()) all else all.filter { it.label.lowercase().contains(q) || it.pkg.contains(q) }
                adapter.notifyDataSetChanged()
            }
            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })
    }

    override fun onBackPressed() { finish() }
}
