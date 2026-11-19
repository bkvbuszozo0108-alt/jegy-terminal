package hu.jarmunaplo.app

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.File

/** A kamera-app ide írja a fotót (androidx nélküli, minimális FileProvider). */
class PhotoProvider : ContentProvider() {
    private fun fileFor(uri: Uri): File {
        val name = uri.lastPathSegment?.replace(Regex("[^A-Za-z0-9_.-]"), "") ?: "foto.jpg"
        val dir = File(context!!.cacheDir, "photos"); dir.mkdirs()
        return File(dir, name)
    }
    override fun onCreate() = true
    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor =
        ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.parseMode(if (mode.contains("w")) "rwt" else "r"))
    override fun getType(uri: Uri) = "image/jpeg"
    override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor {
        val f = fileFor(uri); val c = MatrixCursor(arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE))
        c.addRow(arrayOf<Any>(f.name, f.length())); return c
    }
    override fun insert(uri: Uri, v: ContentValues?): Uri? = null
    override fun delete(uri: Uri, s: String?, a: Array<out String>?) = 0
    override fun update(uri: Uri, v: ContentValues?, s: String?, a: Array<out String>?) = 0
}
