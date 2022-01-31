const crypto = require("crypto");
const AWS = require("aws-sdk");

const firehose = new AWS.Firehose();
const secretsManager = new AWS.SecretsManager();

const SECRET_NAME = process.env.SECRET_NAME;
const DELIVERY_STREAM = process.env.DELIVERY_STREAM;

let secretPromise;

async function getSecret() {
  if (!secretPromise) {
    secretPromise = secretsManager.getSecretValue({ SecretId: SECRET_NAME })
      .promise()
      .then(({ SecretString: secret }) => JSON.parse(secret));
  }

  return await secretPromise;
}

async function validSignature(body, signature) {
  const { shopifyWebhookSecret } = await getSecret();

  const signatureBytes = Buffer.from(signature, "base64");
  const digestBytes = crypto
    .createHmac("sha256", shopifyWebhookSecret)
    .update(body, "utf8")
    .digest();

  return (
    signatureBytes.length === digestBytes.length &&
    crypto.timingSafeEqual(digestBytes, signatureBytes)
  );
}

function getHeader(event, header) {
  header = header.toLowerCase();

  const headers = event.headers;
  for (let h in event.headers) {
    if (
      headers.hasOwnProperty(h) &&
      header === h.toLowerCase()
    ) {
      return event.headers[h];
    }
  }

  return null;
}

function response(status, response) {
  console.log("Responding", { status, response });
  return {
    statusCode: status,
    headers: {},
    body: JSON.stringify(response),
  };
}

exports.main = async function (event, context) {
  try {
    console.log("Handling request", event);

    const acceptedRoute = event.path === "/" && event.httpMethod === "POST";
    if (!acceptedRoute) {
      return response(405, { error: "Unsupported method." });
    }

    const hmac = getHeader(event, "X-Shopify-Hmac-SHA256");
    const authenticated = hmac && await validSignature(event.body, hmac);
    if (!authenticated) {
      return response(401, { error: "Invalid signature." });
    }

    const data = {
      api_version: getHeader(event, "X-Shopify-Api-Version"),
      shop_domain: getHeader(event, "X-Shopify-Shop-Domain"),
      topic: getHeader(event, "X-Shopify-Topic"),
      trace_context: getHeader(event, "X-Shopify-Trace-Context"),
      webhook_id: getHeader(event, "X-Shopify-Webhook-Id"),
      received_webhook_at: new Date().toISOString(),
      event: JSON.parse(event.body)
    };

    await firehose.putRecord({
      DeliveryStreamName: DELIVERY_STREAM,
      Record: {
        Data: JSON.stringify(data),
      },
    }).promise();

    console.log("Successfully put event on firehose");

    return response(202, { message: "Successfully processed" });
  } catch (error) {
    console.error("An error occurred", error);
    return response(500, { error: "An error occurred" });
  }
};
