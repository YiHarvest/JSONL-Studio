import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export function systemLanguage() {
  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}
const preference = localStorage.getItem("language") ?? "system";
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: preference === "system" ? systemLanguage() : preference,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});
export default i18n;
