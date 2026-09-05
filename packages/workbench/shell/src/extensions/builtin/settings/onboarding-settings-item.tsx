"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useMainViewService, useSettingsRegistry } from "@workbench/extension-host";
import { useI18n } from "../../../i18n";
import {
  useWorkbenchSettingsService,
  type WorkbenchSettingsPreferencesPatch,
} from "../../../settings";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
  SettingsGroup,
  SettingsRow,
} from "../../../ui";
import { LocaleSettingsItem } from "../locale-selector/locale-selector";
import { createSettingsMainViewRequest } from "./settings-main-view";
import { readSettingsImport } from "./settings-import";

export function OnboardingSettingsItem() {
  const { t, text } = useI18n();
  const settings = useWorkbenchSettingsService();
  const registry = useSettingsRegistry();
  const sections = useSyncExternalStore(
    registry.subscribe,
    registry.getSections,
    registry.getSections,
  );
  const mainViews = useMainViewService();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [patch, setPatch] = useState<WorkbenchSettingsPreferencesPatch>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <>
      <SettingsGroup>
        <SettingsRow
          label={t("extensions.settings.onboarding.title")}
          description={t("extensions.settings.onboarding.description")}
        >
          <Button
            variant="outline"
            onClick={() => {
              setStep(0);
              setOpen(true);
            }}
          >
            {t("extensions.settings.onboarding.open")}
          </Button>
        </SettingsRow>
      </SettingsGroup>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <DialogContent
          closeLabel={t("extensions.settings.onboarding.close")}
          className="sm:max-w-xl max-h-[85dvh] overflow-y-auto"
        >
          <DialogTitle>{t("extensions.settings.onboarding.title")}</DialogTitle>
          <DialogDescription>
            {t(
              `extensions.settings.onboarding.steps.${step === 0 ? "language" : step === 1 ? "capabilities" : "import"}`,
            )}
          </DialogDescription>
          {step === 0 ? (
            <LocaleSettingsItem sectionId="general" itemId="language" />
          ) : step === 1 ? (
            <div className="flex flex-col gap-2">
              {sections
                .filter(
                  (section) => section.group?.id === "intelligence" || section.group?.id === "data",
                )
                .map((section) => (
                  <Button
                    key={section.id}
                    variant="outline"
                    onClick={() => {
                      setOpen(false);
                      mainViews.open(createSettingsMainViewRequest(section.id));
                    }}
                  >
                    {text(section.title)}
                  </Button>
                ))}
            </div>
          ) : (
            <div className="space-y-3">
              <label htmlFor={`${id}-file`} className="text-sm">
                {t("extensions.settings.onboarding.chooseFile")}
              </label>
              <Input
                id={`${id}-file`}
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setPatch(undefined);
                  setError(false);
                  if (!file) return;
                  if (file.size > 24 * 1024 * 1024) {
                    setError(true);
                    return;
                  }
                  setBusy(true);
                  void file
                    .text()
                    .then((value) => setPatch(readSettingsImport(value)))
                    .catch(() => setError(true))
                    .finally(() => setBusy(false));
                }}
              />
              {patch ? (
                <>
                  <p className="text-sm">{t("extensions.settings.onboarding.review")}</p>
                  <pre className="bg-muted text-muted-foreground overflow-auto rounded-lg p-3 text-xs">
                    {JSON.stringify(
                      {
                        ...patch,
                        ...(patch.backgroundImage
                          ? {
                              backgroundImage: {
                                name: patch.backgroundImage.name,
                                mimeType: patch.backgroundImage.mimeType,
                              },
                            }
                          : {}),
                      },
                      null,
                      2,
                    )}
                  </pre>
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError(false);
                      void settings
                        .update(patch)
                        .then(() => window.location.reload())
                        .catch(() => {
                          setError(true);
                          setBusy(false);
                        });
                    }}
                  >
                    {t("extensions.settings.onboarding.apply")}
                  </Button>
                </>
              ) : null}
              {error ? (
                <p role="alert" className="text-destructive text-sm">
                  {t("extensions.settings.onboarding.error")}
                </p>
              ) : null}
            </div>
          )}
          <div className="flex justify-between gap-2">
            <Button
              variant="ghost"
              disabled={step === 0 || busy}
              onClick={() => setStep((value) => value - 1)}
            >
              {t("extensions.settings.onboarding.back")}
            </Button>
            <Button
              disabled={busy}
              onClick={() => (step === 2 ? setOpen(false) : setStep((value) => value + 1))}
            >
              {t(
                step === 2
                  ? "extensions.settings.onboarding.done"
                  : "extensions.settings.onboarding.next",
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
