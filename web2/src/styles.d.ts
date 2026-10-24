// Vite CSS side-effect imports have no type surface; declare them so tsc
// --noEmit stays clean while bundling keeps doing the real work.
declare module "@mantine/core/styles.css";
declare module "@mantine/charts/styles.css";
declare module "@mantine/notifications/styles.css";
