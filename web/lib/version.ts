import { version as webVersion } from "../package.json";
import { IS_DESKTOP } from "./desktop";

export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || webVersion;
const source = process.env.NEXT_PUBLIC_BUILD_SHA || "";
export const BUILD_ID = /^[a-f0-9]{7,40}$/i.test(source)
  ? source.slice(0, 7).toLowerCase()
  : "";
export const APP_EDITION = IS_DESKTOP ? "Desktop" : "Web";
