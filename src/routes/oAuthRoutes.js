import express from "express";

const oauthRoutes = express.Router();
const BASE_URL = "https://apidomain.ibigdata.in";

// 1. Metadata Endpoint: Claude probes this to discover your auth URLs.
// It looks for standard OpenID configuration paths.
oauthRoutes.get("/.well-known/openid-configuration", (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth2/authorize`,
    token_endpoint: `${BASE_URL}/oauth2/token`,
    registration_endpoint: `${BASE_URL}/oauth2/register`,
    scopes_supported: ["openid", "offline_access"],
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"]
  });
});

// 2. Dynamic Client Registration: Claude asks to register itself as an app.
oauthRoutes.post("/oauth2/register", express.json(), (req, res) => {
  const requested_uris = req.body.redirect_uris || [];
  res.json({
    client_id: "claude-web-dummy-client",
    redirect_uris: requested_uris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
    scope: "openid offline_access"
  });
});

// 3. Authorization Endpoint: The "Login" Page.
// Instead of showing a login UI, we immediately redirect back to Claude with a success code.
oauthRoutes.get("/oauth2/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  
  if (!redirect_uri) {
    return res.status(400).send("Missing redirect_uri");
  }

  const redirectUrl = new URL(redirect_uri);
  // Give Claude a dummy authorization code
  redirectUrl.searchParams.set("code", "dummy_auth_code_12345");
  redirectUrl.searchParams.set("state", state);
  
  // Instantly redirect back to Claude.ai to complete the login
  res.redirect(redirectUrl.toString());
});

// 4. Token Endpoint: Claude exchanges the code for an Access Token.
// OAuth requires this payload to be urlencoded, not JSON.
oauthRoutes.post("/oauth2/token", express.urlencoded({ extended: true }), (req, res) => {
  res.json({
    access_token: "crm_mcp_live_token_999",
    token_type: "Bearer",
    expires_in: 31536000, // Valid for 1 year
    refresh_token: "crm_mcp_refresh_token_888",
    scope: "openid offline_access"
  });
});

export default oauthRoutes;