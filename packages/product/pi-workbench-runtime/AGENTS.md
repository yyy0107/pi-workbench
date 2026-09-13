# Node product policy

Own bundled Skills/Prompts, default inline extension selection/order, built-in package registration,
resource deployment and compatibility migrations. Tool factories belong to pi-runtime-tools;
SDK resource loading/mutation belongs to pi-sdk-resources. Do not import React, frontend product
composition or pi-runtime-server. Keep SDK/public imports explicit and src shallow TypeScript.
Preserve tool/extension IDs, trace observer order, .builtin paths, enablement state and artifact paths.
Changing bundled resource content requires reviewing the matching behavior; moving files does not
justify changing prompts, instructions, credentials or user data. Never run UI tests for this slice.
