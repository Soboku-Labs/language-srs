import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '@language-srs/core';

/**
 * The app's implementation of the core storage port.
 *
 * AsyncStorage covers all three platforms — it is backed by SQLite on Android,
 * a native key-value store on iOS, and localStorage on web — so one adapter
 * serves the whole app and the domain never learns which platform it is on.
 */
export const appStore: KeyValueStore = {
  async get(key) {
    return AsyncStorage.getItem(key);
  },
  async set(key, value) {
    await AsyncStorage.setItem(key, value);
  },
  async remove(key) {
    await AsyncStorage.removeItem(key);
  },
  async keys() {
    return [...(await AsyncStorage.getAllKeys())];
  },
};
