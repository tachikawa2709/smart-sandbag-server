#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <WebSocketsClient.h> // เปลี่ยนมาใช้ Library ของ Links2004
#include <WiFi.h>
#include <Wire.h>
#include <time.h>

// ================= WIFI & CLOUD =================
const char *ssid = "Redmi Note 10S";
const char *password = "1234567890";
const char *wsHost = "smart-sandbag-server.onrender.com";
const int wsPort = 443;

// ================= OBJECT =================
WebSocketsClient webSocket;
Adafruit_MPU6050 mpu;

// ================= STATE =================
int rep = 0;
bool running = false;
bool aboveUp = false;
bool wsConnected = false;
unsigned long lastMsgTime = 0;

// ================= ANGLE =================
float angleOffset = 0;
float smoothAngle = 0;
const float ALPHA = 0.15;
float UP_ANGLE = 45;
float DOWN_ANGLE = 30;

// ================= FUNCTION PROTOTYPES =================
float readRawAngle();
float calibrateAngle();
void syncTime();
void sendDeviceStatus(String statusText);
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length);

// ================= UTIL FUNCTIONS =================
float readRawAngle() {
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  return atan2(a.acceleration.x, a.acceleration.z) * 180 / PI;
}

float calibrateAngle() {
  float sum = 0;
  for (int i = 0; i < 50; i++) {
    sum += readRawAngle();
    delay(10);
  }
  return sum / 50;
}

void syncTime() {
  configTime(7 * 3600, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("⏳ NTP Syncing");
  while (time(nullptr) < 1000000000l) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ Time Synced!");
}

void sendDeviceStatus(String statusText) {
  if (wsConnected) {
    String json =
        "{\"type\":\"status\",\"deviceStatus\":\"" + statusText + "\"}";
    webSocket.sendTXT(json);
  }
}

// ================= WEBSOCKET EVENT HANDLER =================
void webSocketEvent(WStype_t type, uint8_t *payload, size_t length) {
  switch (type) {
  case WStype_DISCONNECTED:
    Serial.println("❎ WebSocket Disconnected!");
    wsConnected = false;
    break;
  case WStype_CONNECTED:
    Serial.println("🔌 WebSocket Connected!");
    wsConnected = true;
    sendDeviceStatus("อุปกรณ์พร้อมใช้งาน (Online)");
    break;
  case WStype_TEXT: {
    String msg = (char *)payload;
    if (msg.indexOf("\"type\":\"sensor\"") >= 0)
      return;

    if (msg.indexOf("reset") >= 0) {
      sendDeviceStatus("กำลังรีบูต...");
      delay(500);
      ESP.restart();
    }

    if (msg.indexOf("running") >= 0) {
      if (msg.indexOf("true") >= 0) {
        running = true;
        sendDeviceStatus("กำลังทำงาน (Running)");
      } else {
        running = false;
        sendDeviceStatus("หยุดชั่วคราว (Paused)");
      }
    }
    break;
  }
  case WStype_ERROR:
    Serial.println("❌ WS Error!");
    break;
  }
}

// ================= SETUP =================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Wire.begin(21, 22);

  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\n✅ WiFi Attached");

  syncTime();

  if (!mpu.begin()) {
    Serial.println("❌ MPU6050 error");
    while (1)
      ;
  }

  Serial.println("🧘 Calibrating...");
  angleOffset = calibrateAngle();
  Serial.println("✅ Calibrated");

  // --- WebSocket Setup ---
  webSocket.beginSSL(wsHost, wsPort, "/"); // เชื่อมต่อผ่าน WSS
  webSocket.onEvent(webSocketEvent);
  webSocket.setReconnectInterval(5000); // รองรับการต่อใหม่กรณีหลุด

  // เพิ่ม Header สำคัญสำหรับ Cloud
  webSocket.setExtraHeaders(
      "Origin: https://smart-sandbag-server.onrender.com");
}

// ================= LOOP =================
void loop() {
  webSocket.loop();

  float raw = readRawAngle() - angleOffset;
  smoothAngle = ALPHA * raw + (1 - ALPHA) * smoothAngle;

  if (running) {
    if (!aboveUp && smoothAngle > UP_ANGLE)
      aboveUp = true;
    if (aboveUp && smoothAngle < DOWN_ANGLE) {
      rep++;
      aboveUp = false;
    }
  }

  // ส่งข้อมูลทุกๆ 100ms ถ้าเชื่อมต่ออยู่
  if (wsConnected && (millis() - lastMsgTime > 100)) {
    lastMsgTime = millis();
    String msg = String("{\"type\":\"sensor\",\"payload\":{") +
                 "\"angle\":" + String(smoothAngle, 2) + "," +
                 "\"rep\":" + rep + "," +
                 "\"running\":" + (running ? "true" : "false") + "," +
                 "\"deviceStatus\":\"Online\"" + "}}";
    webSocket.sendTXT(msg);
  }
}
