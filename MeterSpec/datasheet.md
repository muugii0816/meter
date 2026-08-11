# Meter Datasheet

## 1. Model Overview
- **Model name:** Generic Smart Meter
- **Manufacturer:** [Manufacturer Name]
- **Form factor:** DIN rail / panel mount
- **Application:** Electricity metering for buildings, industrial loads, and remote monitoring.

## 2. Functional Description
- Measures active energy (kWh), reactive energy (kVARh), voltage, current, power, and power factor.
- Supports online status, load profiling, and alarm reporting.
- Provides remote data access through communication interfaces.

## 3. Working Principle
1. Voltage and current are sensed through potential transformers (PTs) and current transformers (CTs).
2. The meter’s energy measurement engine computes active and reactive energy by sampling instantaneous voltage and current.
3. Power factor is calculated from real and apparent power values.
4. Load profile data is aggregated over fixed intervals (e.g. 15-minute or hourly buckets).
5. Alarms, communication status, and signal diagnostics are reported by the embedded gateway.

## 4. Supported Data Types
- Active energy (kWh)
- Reactive energy (kVARh)
- Instantaneous voltage (V)
- Instantaneous current (A)
- Active power (kW)
- Apparent power (kVA)
- Power factor
- Frequency (Hz)
- Energy cost estimates
- Online/offline status
- Alarm indicators (tamper, communication, voltage, current, power failure)
- Load profile and billing data

## 5. Remote Data Access
- Communication interfaces:
  - RS-485 / Modbus RTU
  - Ethernet / Modbus TCP
  - Wireless (LoRaWAN / NB-IoT / LTE-M)
- Supported protocols:
  - Modbus
  - DLMS/COSEM
  - IEC 62056

## 6. Installation Notes
- Ensure correct CT/PT wiring and polarity.
- Use surge protection for line and communication ports.
- Install in a dry, ventilated enclosure.

## 7. Example Data Sheet Fields
| Field | Description |
| --- | --- |
| Meter model | Model number and series |
| Accuracy class | 0.2S / 0.5S / 1.0 |
| Voltage range | e.g. 57.7 - 300 V |
| Current range | e.g. 5 A / 100 A |
| Communication | RS-485, Ethernet, Wireless |
| Measurement interval | 1 min / 15 min / 1 hour |
| Supported registers | Modbus addresses or DLMS OBIS codes |

## 8. Notes
- Add files for specific meter models as the system grows.
- Keep datasheets up to date with firmware and protocol changes.
