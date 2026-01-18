import axios from "axios";

export default async function sendSms(phoneNumber, otpCode) {
  try {
    const API_KEY = process.env.TWO_FACTOR_API_KEY;

    console.log(otpCode);
    // 2Factor CUSTOM OTP API
    const url = `https://2factor.in/API/V1/${API_KEY}/SMS/${phoneNumber}/${otpCode}`;

    const response = await axios.get(url, { timeout: 10000 });

    if (response.data?.Status !== "Success") {
      const err = new Error("2Factor rejected the request");
      err.name = "SmsError";
      err.provider = "2factor";
      err.details = response.data;
      throw err;
    }

    return true;
  } catch (error) {
    const apiData = error.response?.data;

    const providerMessage =
      apiData?.Details || apiData?.message || error.message;

    const err = new Error(`SMS failed: ${providerMessage}`);
    err.name = "SmsError";
    err.provider = "2factor";
    err.status = error.response?.status || 502;
    err.details = apiData || {};

    throw err;
  }
}
