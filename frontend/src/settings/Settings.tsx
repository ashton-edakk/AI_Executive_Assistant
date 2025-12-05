import { useState, useEffect } from 'react';
import { 
  Settings as SettingsIcon, 
  Clock, 
  Globe, 
  Bell, 
  Save,
  X,
  Check
} from 'lucide-react';

interface UserSettings {
  timezone: string;
  workingHoursStart: string;
  workingHoursEnd: string;
  defaultTaskDuration: number;
  enableNotifications: boolean;
}

const DEFAULT_SETTINGS: UserSettings = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  workingHoursStart: '09:00',
  workingHoursEnd: '17:00',
  defaultTaskDuration: 60,
  enableNotifications: true,
};

const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Dubai',
  'Australia/Sydney',
  'Pacific/Auckland',
];

interface SettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function Settings({ isOpen, onClose }: SettingsProps) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load settings from localStorage on mount
    const savedSettings = localStorage.getItem('userSettings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (e) {
        console.error('Failed to parse saved settings:', e);
      }
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('userSettings', JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleChange = (key: keyof UserSettings, value: string | number | boolean) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-6 h-6" />
            <h2 className="text-xl font-bold">Settings</h2>
          </div>
          <button 
            onClick={onClose}
            className="hover:bg-white/20 p-2 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Timezone */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Globe className="w-4 h-4 text-indigo-600" />
              Timezone
            </label>
            <select
              value={settings.timezone}
              onChange={(e) => handleChange('timezone', e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors bg-white"
            >
              {COMMON_TIMEZONES.map(tz => (
                <option key={tz} value={tz}>{tz.replace('_', ' ')}</option>
              ))}
            </select>
          </div>

          {/* Working Hours */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Clock className="w-4 h-4 text-indigo-600" />
              Working Hours
            </label>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">Start</label>
                <input
                  type="time"
                  value={settings.workingHoursStart}
                  onChange={(e) => handleChange('workingHoursStart', e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>
              <span className="text-gray-400 pt-5">to</span>
              <div className="flex-1">
                <label className="text-xs text-gray-500 mb-1 block">End</label>
                <input
                  type="time"
                  value={settings.workingHoursEnd}
                  onChange={(e) => handleChange('workingHoursEnd', e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-colors"
                />
              </div>
            </div>
          </div>

          {/* Default Task Duration */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Clock className="w-4 h-4 text-indigo-600" />
              Default Task Duration (minutes)
            </label>
            <div className="flex gap-2">
              {[15, 30, 45, 60, 90, 120].map(duration => (
                <button
                  key={duration}
                  onClick={() => handleChange('defaultTaskDuration', duration)}
                  className={`px-4 py-2 rounded-lg border transition-colors ${
                    settings.defaultTaskDuration === duration
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-300'
                  }`}
                >
                  {duration}m
                </button>
              ))}
            </div>
          </div>

          {/* Notifications */}
          <div className="flex items-center justify-between py-3 border-t border-gray-100">
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
              <Bell className="w-4 h-4 text-indigo-600" />
              Enable Notifications
            </label>
            <button
              onClick={() => handleChange('enableNotifications', !settings.enableNotifications)}
              className={`relative w-12 h-6 rounded-full transition-colors ${
                settings.enableNotifications ? 'bg-indigo-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                  settings.enableNotifications ? 'translate-x-6' : ''
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className={`px-6 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
              saved 
                ? 'bg-green-500 text-white' 
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {saved ? (
              <>
                <Check className="w-4 h-4" />
                Saved!
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Export helper to get settings
export function getUserSettings(): UserSettings {
  const savedSettings = localStorage.getItem('userSettings');
  if (savedSettings) {
    try {
      return JSON.parse(savedSettings);
    } catch {
      return DEFAULT_SETTINGS;
    }
  }
  return DEFAULT_SETTINGS;
}

