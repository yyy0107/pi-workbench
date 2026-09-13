import type { MainViewBreadcrumbs } from "@workbench/extension-sdk";

export function freezeBreadcrumbs<P extends Record<string, unknown>>(
  breadcrumbs: MainViewBreadcrumbs<P>,
): MainViewBreadcrumbs<P> {
  return Object.freeze(
    breadcrumbs.map((item) =>
      Object.freeze({
        label: item.label,
        ...(item.params !== undefined ? { params: Object.freeze({ ...item.params }) as P } : {}),
        ...(item.closeView === true ? { closeView: true as const } : {}),
      }),
    ),
  ) as unknown as MainViewBreadcrumbs<P>;
}
