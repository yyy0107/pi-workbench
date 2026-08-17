export function WorkbenchBrand() {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <img
        src="/pi-logo-on-light.svg"
        alt=""
        aria-hidden="true"
        className="size-7 shrink-0 dark:invert"
      />
      <span className="truncate text-base font-semibold tracking-tight">Pi-Workbench</span>
    </div>
  );
}
