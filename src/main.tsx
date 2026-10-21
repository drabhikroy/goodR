// Fonts are bundled with the app rather than loaded from the web, so the
// interface looks the same offline and on every platform.
import "@fontsource-variable/dm-sans/opsz.css";
import "@fontsource/dm-mono/400.css";
import "@fontsource/dm-mono/500.css";
// The other code typefaces offered in Settings, all under the SIL Open
// Font License.
import "@fontsource-variable/jetbrains-mono/wght.css";
import "@fontsource-variable/jetbrains-mono/wght-italic.css";
import "@fontsource-variable/fira-code/wght.css";
import "@fontsource-variable/source-code-pro/wght.css";
import "@fontsource-variable/source-code-pro/wght-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/400-italic.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource-variable/cascadia-code/wght.css";
import "@fontsource-variable/cascadia-code/wght-italic.css";
import "@fontsource-variable/victor-mono/wght.css";
import "@fontsource-variable/victor-mono/wght-italic.css";
import "@fontsource/monaspace-neon/400.css";
import "@fontsource/monaspace-neon/400-italic.css";
import "@fontsource/monaspace-radon/400.css";
import "@fontsource/monaspace-radon/400-italic.css";
import "@fontsource/commit-mono/400.css";
import "@fontsource/commit-mono/400-italic.css";
import "@fontsource-variable/geist-mono/wght.css";
import "@fontsource/iosevka/400.css";
import "@fontsource/iosevka/400-italic.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght.css";
import "@fontsource-variable/atkinson-hyperlegible-mono/wght-italic.css";
import "@fontsource/intel-one-mono/400.css";
import "@fontsource/intel-one-mono/400-italic.css";
import "./styles/app.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
