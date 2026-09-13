export const messages = {
  extensions: {
    about: {
      title: "About",
      productDescription: "A local-first development workspace purpose-built for Pi.",
      version: "Version",
      license: "License",
      source: "Source",
      openSourceSoftware: "Key open-source software",
      contribute: "Contribute",
      issues: "Issues",
      pullRequests: "Pull Requests",
      openExternal: ({ label }: { label: string }) => `${label} (opens externally)`,
      unavailable: "Unavailable",
    },
    connectionStatus: {
      loading: "Loading",
      streaming: "Streaming",
      ready: "Ready",
      accessibleLabel: ({ status }: { status: string }) => `Assistant runtime: ${status}`,
      description: "Derived from the local assistant runtime",
      workbenchVersionDescription: ({
        productName,
        version,
      }: {
        productName: string;
        version: string;
      }) => `${productName} version ${version}`,
      workbenchVersionLoading: ({ productName }: { productName: string }) =>
        `Loading the ${productName} version`,
    },
    runningIndicator: {
      piLogoShine: "Pi logo · Light sweep",
      piLogoShineInverted: "Pi logo · Inverted light sweep",
      piWordmarkOnLight: "Pixel wordmark · Light theme",
      piWordmarkOnDark: "Pixel wordmark · Dark theme",
    },
  },
};
