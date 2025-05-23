const axios = require('axios');
require('dotenv').config();

let accessToken = '';

async function refreshAccessToken() {
  const res = await axios.post(`${process.env.ZOHO_ACCOUNTS_URL}/oauth/v2/token`, null, {
    params: {
      refresh_token: process.env.ZOHO_REFRESH_TOKEN,
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      grant_type: 'refresh_token',
    },
  });

  accessToken = res.data.access_token;
  return accessToken;
}

async function zohoRequest(endpoint, method = 'GET', data = {}) {
  if (!accessToken) await refreshAccessToken();

  try {
    const res = await axios({
      method,
      url: `${process.env.ZOHO_API_DOMAIN}${endpoint}`,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
      },
      data,
    });

    return res.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      await refreshAccessToken();
      return zohoRequest(endpoint, method, data);
    } else {
      throw error;
    }
  }
}

module.exports = {
  zohoRequest,
};
