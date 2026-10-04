import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPracticeStore } from "./storage-core";

const store = createPracticeStore(AsyncStorage);

export const {
  getSavedState,
  saveDraft,
  saveSession,
  deleteSession,
  setBookmark,
  clearHistory,
  clearAllPractice,
} = store;
