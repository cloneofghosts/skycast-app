# SkyCast App - BrightSky weather viewer

A react app built with tailwind CSS to view hourly data from the [BrightSky API](https://brightsky.dev) using Nominatim Geocoding API for the location search.

## Notes
BrightSky hourly forecasted data uses the MOSMIX_S/MOSMIX_L data from DWD which is only available for certain locations around the world and the data varies by station. If the station you queried is missing data then N/A will be shown.

This app also calculates the relative humidity if not available and also calculates a feels like temperature based on the data. The daily forecast is also calculated by getting the maximum and minimum temperature for the day (12am-12am).
