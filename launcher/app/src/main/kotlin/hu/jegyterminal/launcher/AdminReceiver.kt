package hu.jegyterminal.launcher

import android.app.admin.DeviceAdminReceiver

/** Device owner fogadó – kioszk (Lock Task) módhoz. Beállítás USB-n: adb shell dpm set-device-owner hu.jegyterminal.launcher/.AdminReceiver */
class AdminReceiver : DeviceAdminReceiver()
