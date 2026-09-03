import protobuf from "protobufjs";

/**
 * The subset of the Widevine protocol needed to request a license and read the
 * content keys back.
 *
 * `client_id` is declared as `bytes` rather than the full ClientIdentification
 * message: on the wire an embedded message and a bytes field are encoded
 * identically (both length-delimited), and the device file already holds it
 * pre-serialised, so it can be passed through opaquely. That removes several
 * hundred lines of schema that would otherwise need porting for no benefit.
 */
const SCHEMA = `
syntax = "proto2";
package widevine;

message LicenseIdentification {
  optional bytes request_id = 1;
  optional bytes session_id = 2;
  optional bytes purchase_id = 3;
  optional int32 type = 4;
  optional int32 version = 5;
  optional bytes provider_session_token = 6;
}

message License {
  message Policy {
    optional bool can_play = 1;
    optional bool can_persist = 2;
    optional bool can_renew = 3;
    optional int64 rental_duration_seconds = 4;
    optional int64 playback_duration_seconds = 5;
    optional int64 license_duration_seconds = 6;
  }

  message KeyContainer {
    message OutputProtection {
      optional int32 hdcp = 1;
      optional int32 cgms_flags = 2;
    }
    message KeyControl {
      optional bytes key_control_block = 1;
      optional bytes iv = 2;
    }
    optional bytes id = 1;
    optional bytes iv = 2;
    optional bytes key = 3;
    optional int32 type = 4;
    optional int32 level = 5;
    optional OutputProtection required_protection = 6;
    optional OutputProtection requested_protection = 7;
    optional KeyControl key_control = 8;
    optional bytes track_label = 12;
  }

  optional LicenseIdentification id = 1;
  optional Policy policy = 2;
  repeated KeyContainer key = 3;
  optional int64 license_start_time = 4;
  optional bool remote_attestation_verified = 5;
  optional bytes provider_client_token = 6;
}

message LicenseRequest {
  message ContentIdentification {
    message WidevinePsshData {
      repeated bytes pssh_data = 1;
      optional int32 license_type = 2;
      optional bytes request_id = 3;
    }
    message WebmKeyId {
      optional bytes header = 1;
      optional int32 license_type = 2;
      optional bytes request_id = 3;
    }
    message ExistingLicense {
      optional LicenseIdentification license_id = 1;
      optional int64 seconds_since_started = 2;
      optional int64 seconds_since_last_played = 3;
      optional bytes session_usage_table_entry = 4;
    }
    optional WidevinePsshData widevine_pssh_data = 1;
    optional WebmKeyId webm_key_id = 2;
    optional ExistingLicense existing_license = 3;
  }

  optional bytes client_id = 1;
  optional ContentIdentification content_id = 2;
  optional int32 type = 3;
  optional int64 request_time = 4;
  optional bytes key_control_nonce_deprecated = 5;
  optional int32 protocol_version = 6;
  optional uint32 key_control_nonce = 7;
}

message SignedMessage {
  optional int32 type = 1;
  optional bytes msg = 2;
  optional bytes signature = 3;
  optional bytes session_key = 4;
  optional bytes remote_attestation = 5;
  repeated bytes metric_data = 6;
  optional bytes service_version_info = 7;
  optional bytes session_init_data = 8;
  optional bytes oemcrypto_core_message = 9;
}

message WidevinePsshData {
  repeated bytes key_id = 2;
  optional string content_id = 4;
  optional string provider = 6;
  optional bytes protection_scheme = 9;
}
`;

const root = protobuf.parse(SCHEMA, { keepCase: true }).root;

export const LicenseRequest = root.lookupType("widevine.LicenseRequest");
export const License = root.lookupType("widevine.License");
export const SignedMessage = root.lookupType("widevine.SignedMessage");
export const WidevinePsshData = root.lookupType("widevine.WidevinePsshData");

/** SignedMessage.type values. */
export const MessageType = {
  LICENSE_REQUEST: 1,
  LICENSE: 2,
  ERROR_RESPONSE: 3,
  SERVICE_CERTIFICATE_REQUEST: 4,
  SERVICE_CERTIFICATE: 5,
} as const;

/** LicenseRequest.type values. */
export const RequestType = {
  NEW: 1,
  RENEWAL: 2,
  RELEASE: 3,
} as const;

/** ContentIdentification license_type values. */
export const LicenseType = {
  STREAMING: 1,
  OFFLINE: 2,
  AUTOMATIC: 3,
} as const;

/** KeyContainer.type values. */
export const KeyType = {
  SIGNING: 1,
  CONTENT: 2,
  KEY_CONTROL: 3,
  OPERATOR_SESSION: 4,
} as const;

export function keyTypeName(value: number | undefined): string {
  const entry = Object.entries(KeyType).find(([, v]) => v === value);
  return entry?.[0] ?? String(value ?? "UNKNOWN");
}
