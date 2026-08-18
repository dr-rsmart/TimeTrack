import { useState } from 'react';

interface LocationPermissionModalProps {
  open: boolean;
  onClose: () => void;
  permission: 'granted' | 'denied' | 'unknown';
  suggestions?: string[];
}

export function LocationPermissionModal({ open, onClose, permission, suggestions }: LocationPermissionModalProps) {
  if (!open) return null;

  const isDenied = permission === 'denied';
  const isUnknown = permission === 'unknown';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-2xl">📍</span>
          <h2 className="text-lg font-semibold text-slate-900">Location Access Required</h2>
        </div>

        <div className="mb-6">
          {isDenied ? (
            <>
              <p className="mb-4 text-slate-700">
                Location access has been <strong>blocked</strong> for this site. 
                TimeTrack needs your GPS location to validate clock-in/out at your work geofence.
              </p>
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-100">
                <h4 className="font-semibold mb-2 text-sm text-slate-900">To enable location access:</h4>
                <ol className="list-decimal list-inside space-y-2 text-sm text-slate-600">
                  {suggestions?.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            </>
          ) : isUnknown ? (
            <>
              <p className="mb-4 text-slate-700">
                TimeTrack needs your GPS location to validate clock-in/out at your work geofence.
                Your browser will ask for permission shortly.
              </p>
              <div className="rounded-lg bg-slate-50 p-4 border border-slate-100">
                <h4 className="font-semibold mb-2 text-sm text-slate-900">What we do with your location:</h4>
                <ul className="space-y-1 text-sm text-slate-600">
                  <li>• Only used to verify you are within your assigned work area</li>
                  <li>• Not stored permanently on our servers</li>
                  <li>• You can disable auto-clock-in anytime in Settings</li>
                </ul>
              </div>
            </>
          ) : (
            <p className="text-slate-700">Your location is being acquired...</p>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            {isDenied ? 'Maybe Later' : 'Cancel'}
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {isDenied ? "I've Enabled Location — Retry" : 'Try Again'}
          </button>
        </div>
      </div>
    </div>
  );
}