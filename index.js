const playwright = require("playwright-chromium");
const codec = require("string-codec");
const FormData = require("form-data");
const axios = require("axios");
const { Telegraf } = require("telegraf");
require("dotenv").config();

const ACCOUNT_EMAIL = process.env.ACCOUNT_EMAIL;
const ACCOUNT_PASSWORD = process.env.ACCOUNT_PASSWORD;
const BOT_TOKEN = process.env.TG_TOKEN;
if (!ACCOUNT_EMAIL || !ACCOUNT_PASSWORD || !BOT_TOKEN) {
  console.error("Email, Password, or Bot token is missing!");
  return;
}

const checkUsername = async (username) => {
  if (username === process.env.TG_USERNAME) {
    return true;
  }

  return false;
};

const main = async (tgToken, accountEmail, accountPassword) => {
  const bot = new Telegraf(tgToken);
  bot.command("start", (ctx) => {
    ctx.reply("Hello world!");
  });

  bot.command("clockin", async (ctx) => {
    if (!(await checkUsername(ctx.from.username))) {
      console.log("Not authorized");
      ctx.reply("Not authorized!");
      throw "Not authorized!";
    }
    // when it's authorized, the username that sent the message is good
    await talentaApi(accountEmail, accountPassword, "CHECK_IN");
    return "success";
  });

  bot.command("clockout", async (ctx) => {
    if (!(await checkUsername(ctx.from.username))) {
      console.log("Not authorized");
      ctx.reply("Not authorized!");
      throw "Not authorized!";
    }
    // when it's authorized, the username that sent the message is good
    await talentaApi(accountEmail, accountPassword, "CHECK_OUT");
    return "success";
  });

  bot.launch();

  // Graceful shutdown
  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));
};

const talentaApi = async (accountEmail, accountPassword, checkType) => {
  let geoLatitude = "";
  let geoLongitude = "";

  const isHeadless = process.env.HEADLESS_BROWSER === "true";

  const browser = await playwright["chromium"].launch({
    headless: isHeadless,
  });

  geoLatitude = process.env.GEO_LATITUDE;
  geoLongitude = process.env.GEO_LONGITUDE;

  const context = await browser.newContext({
    viewport: { width: 1080, height: 560 },
    geolocation: {
      latitude: Number(geoLatitude),
      longitude: Number(geoLongitude),
    },
    permissions: ["geolocation"],
  });

  const page = await context.newPage();

  console.log("Opening login page...");
  await page.goto(
    "https://account.mekari.com/users/sign_in?client_id=TAL-73645&return_to=L2F1dGg_Y2xpZW50X2lkPVRBTC03MzY0NSZyZXNwb25zZV90eXBlPWNvZGUmc2NvcGU9c3NvOnByb2ZpbGU%3D"
  );

  await page.setViewportSize({ width: 1080, height: 560 });

  console.log("Filling in account email & password...");
  await page.click("#user_email");
  await page.fill("#user_email", accountEmail);

  await page.press("#user_email", "Tab");
  await page.fill("#user_password", accountPassword); // Updated code

  console.log("Signing in...");
  await Promise.all([
    page.click("#new-signin-button"),
    page.waitForURL("**/employee/dashboard"),
  ]);

  const dashboardNav = page.getByText("Dashboard");
  if ((await dashboardNav.innerText()) === "Dashboard") {
    console.log("Successfully Logged in...");
  }

  const myName = (await page.locator("#navbar-name").textContent()).trim();
  const whoIsOffToday = await page
    .locator(".tl-card-small", { hasText: `Who's Off` })
    .innerText();

  const isOffToday = whoIsOffToday.includes(myName);

  if (isOffToday) {
    console.log("You are off today, skipping check in/out...");
    await browser.close();
    return;
  }

  if (process.env.SKIP_CHECK_IN_OUT === "true") {
    console.log("Skipping Check In/Out...");
    await browser.close();
    return;
  }

  const cookies = await context.cookies();

  let obj = cookies.find((o) => o.name === "PHPSESSID");

  if (obj === undefined) {
    console.log("Can't find PHPSESSID Cookies");
    await browser.close();
    return;
  }

  let desc = "";
  const isCheckOut = checkType === "CHECK_OUT";

  const config = prepForm({
    long: geoLongitude,
    lat: geoLatitude,
    desc: desc,
    cookies: "PHPSESSID=" + obj.value,
    isCheckOut: isCheckOut,
  });

  const data = await attendancePost(config);

  console.log("Success " + checkType);

  await browser.close();

  return data;
};

const prepForm = (obj) => {
  const { long, lat, desc, cookies, isCheckOut = false } = obj;
  const data = new FormData();
  const status = isCheckOut ? "checkout" : "checkin";

  const longEncoded = codec.encoder(codec.encoder(long, "base64"), "rot13");
  const latEncoded = codec.encoder(codec.encoder(lat, "base64"), "rot13");

  data.append("longitude", longEncoded);
  data.append("latitude", latEncoded);
  data.append("status", status);
  data.append("description", desc);

  const config = {
    method: "post",
    url: "https://hr.talenta.co/api/web/live-attendance/request",
    headers: {
      Cookie: cookies,
      ...data.getHeaders(),
    },
    data: data,
  };

  return config;
};

const attendancePost = async (config) => {
  const resp = await axios(config);

  console.log(resp.data);

  return resp.data;
};

try {
  main(BOT_TOKEN, ACCOUNT_EMAIL, ACCOUNT_PASSWORD);
  // await talentaApi(ACCOUNT_EMAIL, ACCOUNT_PASSWORD, CHECK_TYPE);
} catch (err) {
  console.error(err);
  return err;
}
