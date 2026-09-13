"use client";
import { useTranslationBundle } from "@workbench/i18n";
import { directoryPickerTranslationBundle } from "./i18n";
export function useDirectoryPickerI18n() {
  return useTranslationBundle(directoryPickerTranslationBundle);
}
