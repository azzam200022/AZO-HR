package com.azzam200022.azo;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.UUID;

/** Durable, employee-scoped queue for fixes captured while the network is unavailable. */
public final class LocationQueueDatabase extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "azo_location_queue.db";
    private static final int DATABASE_VERSION = 1;
    private static final String TABLE = "pending_location_samples";

    public LocationQueueDatabase(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase database) {
        database.execSQL(
            "CREATE TABLE " + TABLE + " (" +
                "event_id TEXT PRIMARY KEY NOT NULL, " +
                "employee_id TEXT NOT NULL, " +
                "latitude REAL NOT NULL, " +
                "longitude REAL NOT NULL, " +
                "observed_at_ms INTEGER NOT NULL, " +
                "accuracy_m REAL" +
            ")"
        );
        database.execSQL(
            "CREATE INDEX pending_location_employee_time ON " + TABLE +
                "(employee_id, observed_at_ms)"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase database, int oldVersion, int newVersion) {
        // Preserve queued location samples across app upgrades.
    }

    public synchronized void enqueue(String employeeId, Location location) {
        if (employeeId == null || employeeId.trim().isEmpty() || location == null) return;
        long observedAt = location.getTime() > 0 ? location.getTime() : System.currentTimeMillis();

        ContentValues values = new ContentValues();
        values.put("event_id", UUID.randomUUID().toString());
        values.put("employee_id", employeeId);
        values.put("latitude", location.getLatitude());
        values.put("longitude", location.getLongitude());
        values.put("observed_at_ms", observedAt);
        if (location.hasAccuracy()) values.put("accuracy_m", (double) location.getAccuracy());
        else values.putNull("accuracy_m");

        getWritableDatabase().insertWithOnConflict(
            TABLE,
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE
        );
    }

    public synchronized JSONArray readBatch(String employeeId, int limit) throws JSONException {
        JSONArray samples = new JSONArray();
        if (employeeId == null || employeeId.trim().isEmpty()) return samples;

        String sql =
            "SELECT event_id, employee_id, latitude, longitude, observed_at_ms, accuracy_m " +
            "FROM " + TABLE +
            " WHERE employee_id = ? ORDER BY observed_at_ms ASC, rowid ASC LIMIT ?";
        try (Cursor cursor = getReadableDatabase().rawQuery(
            sql,
            new String[] { employeeId, Integer.toString(limit) }
        )) {
            while (cursor.moveToNext()) {
                JSONObject sample = new JSONObject();
                sample.put("event_id", cursor.getString(0));
                sample.put("employee_id", cursor.getString(1));
                sample.put("lat", cursor.getDouble(2));
                sample.put("lng", cursor.getDouble(3));
                sample.put("observed_at_ms", cursor.getLong(4));
                if (!cursor.isNull(5)) sample.put("accuracy_m", cursor.getDouble(5));
                samples.put(sample);
            }
        }
        return samples;
    }

    public synchronized void deleteAcknowledged(String employeeId, JSONArray eventIds) {
        if (employeeId == null || eventIds == null || eventIds.length() == 0) return;
        SQLiteDatabase database = getWritableDatabase();
        database.beginTransaction();
        try {
            for (int i = 0; i < eventIds.length(); i++) {
                String eventId;
                try {
                    eventId = eventIds.getString(i);
                } catch (JSONException ignored) {
                    continue;
                }
                database.delete(
                    TABLE,
                    "employee_id = ? AND event_id = ?",
                    new String[] { employeeId, eventId }
                );
            }
            database.setTransactionSuccessful();
        } finally {
            database.endTransaction();
        }
    }
}
