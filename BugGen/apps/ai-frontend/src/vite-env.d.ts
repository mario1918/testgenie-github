/// <reference types="vite/client" />

type ViteImportMetaEnv = {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ZEPHYR_APP_URL?: string;
};

interface ImportMetaEnv extends ViteImportMetaEnv {}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
