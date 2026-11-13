/**
 * Staging-ready `clientConfig.ts` replacement for `Rhemito-web` (`staging_next_js`).
 *
 * Key fix vs. current `staging_next_js/clientConfig.ts`:
 * - Points `dev` (`NEXT_PUBLIC__ENV=dev` on `https://rhemito-web-nextjs-dev.herokuapp.com/`)
 *   to `furp02-core` Staging (`https://furp02-staging.funtechcom.com/api/v1/`) and Checkout.com Sandbox,
 *   instead of accidentally hitting Live `furp02-pre-pord`!
 * - Keeps `prod` (`NEXT_PUBLIC__ENV=prod` on `https://www.rhemito.com/`) 100% untouched so
 *   promoting `staging_next_js` → `prod_main` requires ZERO code edits.
 */

interface Config {
  apiUrl: string;
  apiKey: string;
  checkoutTokenApi: string;
  domain: string;
  appleMerchantId: string;
}

interface ClientConfig {
  local: Config;
  dev: Config;
  alpha: Config;
  prod: Config;
}

const STAGING_API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://furp02-staging.funtechcom.com/api/v1/";

const STAGING_API_KEY =
  process.env.NEXT_PUBLIC_API_KEY ||
  "d2783dc0-0ebc-4980-98ec-6203215f81ec";

const config: ClientConfig = {
  local: {
    apiUrl: STAGING_API_URL,
    apiKey: STAGING_API_KEY,
    checkoutTokenApi: "https://api.sandbox.checkout.com/tokens",
    domain: "localhost:3000",
    appleMerchantId: "merchant.com.rhemito.sandbox",
  },
  dev: {
    apiUrl: STAGING_API_URL,
    apiKey: STAGING_API_KEY,
    checkoutTokenApi: "https://api.sandbox.checkout.com/tokens",
    domain: "rhemito-web-nextjs-dev.herokuapp.com",
    appleMerchantId: "merchant.com.rhemito.sandbox",
  },
  alpha: {
    apiUrl: STAGING_API_URL,
    apiKey: STAGING_API_KEY,
    checkoutTokenApi: "https://api.sandbox.checkout.com/tokens",
    domain: "rhemito-web-nextjs-dev.herokuapp.com",
    appleMerchantId: "merchant.com.rhemito.sandbox",
  },
  prod: {
    apiUrl: "https://furp02-pre-pord.funtechcom.com/api/v1/",
    apiKey: "d2783dc0-0ebc-4980-98ec-6203215f81ec",
    checkoutTokenApi: "https://api.checkout.com/tokens",
    domain: "www.rhemito.com",
    appleMerchantId: "merchant.com.rhemito.production",
  },
};

// @ts-ignore
const envType: "local" | "dev" | "alpha" | "prod" =
  (process.env.NEXT_PUBLIC__ENV as "local" | "dev" | "alpha" | "prod") || "local";

export default config[envType];
