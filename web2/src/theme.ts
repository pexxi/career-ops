import { createTheme } from "@mantine/core";

// Deliberately near-default Mantine: the enterprisey feel comes from density
// and typography, not a bespoke palette.
export const theme = createTheme({
  primaryColor: "indigo",
  defaultRadius: "sm",
  headings: { fontWeight: "600" },
  fontSizes: { xs: "11px" },
});
