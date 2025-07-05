import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Sun, Moon, CloudSun, CloudMoon, Cloud, CloudFog, Wind, CloudRain, CloudSnow, Snowflake, CloudHail, CloudLightning, HelpCircle, Thermometer, Droplet, Gauge, Eye, ThermometerSun } from 'lucide-react'; // Import Lucide icons

// Function to find the weather data for the current hour
const getCurrentHourWeather = (hourlyData) => {
    if (!hourlyData || hourlyData.length === 0) return null;

    const now = new Date();
    let closestHourData = null;
    let minDiff = Infinity;

    hourlyData.forEach(hour => {
        const hourTime = new Date(hour.timestamp);
        const diff = Math.abs(hourTime.getTime() - now.getTime());

        if (diff < minDiff) {
            minDiff = diff;
            closestHourData = hour;
        }
    });
    return closestHourData;
};

// Function to calculate relative humidity from temperature (K) and dew point (K)
const calculateRelativeHumidity = (temperatureK, dewPointK) => {
    if (temperatureK === null || dewPointK === null || temperatureK === undefined || dewPointK === undefined) {
        return null;
    }

    // Convert Kelvin to Celsius for the formula
    const T = temperatureK - 273.15; // Temperature in Celsius
    const Td = dewPointK - 273.15; // Dew point in Celsius

    // Magnus formula constants (for temperature in Celsius)
    const A = 17.62;
    const B = 243.12;

    // Calculate saturation vapor pressure at temperature T
    const es = 6.112 * Math.exp((A * T) / (B + T));
    // Calculate actual vapor pressure at dew point Td
    const ea = 6.112 * Math.exp((A * Td) / (B + Td));

    // Calculate relative humidity
    const rh = (ea / es) * 100;

    // Ensure RH is within a valid range [0, 100]
    return Math.min(100, Math.max(0, rh));
};

// Function to calculate apparent temperature (Heat Index or Wind Chill)
// Based on common approximations. Requires Kelvin for temp, percentage for humidity, m/s for wind_speed.
const calculateApparentTemperature = (temperatureK, humidityFromAPI, windSpeedMs, dewPointK) => {
    if (temperatureK === null || temperatureK === undefined) return null;

    let actualHumidity = humidityFromAPI;
    // If humidity is not provided by API, try to calculate it from dewPointK
    if ((actualHumidity === null || actualHumidity === undefined || isNaN(actualHumidity)) && dewPointK !== null && dewPointK !== undefined) {
        actualHumidity = calculateRelativeHumidity(temperatureK, dewPointK);
    }

    // If humidity is still not available or invalid, or windSpeed is invalid, return null
    if (actualHumidity === null || actualHumidity === undefined || isNaN(actualHumidity) ||
        windSpeedMs === null || windSpeedMs === undefined || isNaN(windSpeedMs)) {
        return null;
    }

    const T_c = temperatureK - 273.15; // Convert Kelvin to Celsius

    // Wind Chill (for cold temperatures and wind)
    // Formula valid for T_c <= 10°C and windSpeedMs >= 1.3 m/s
    if (T_c <= 10 && windSpeedMs >= 1.3) {
        const V_kmh = windSpeedMs * 3.6; // Convert m/s to km/h for the formula
        const windChill_c = 13.12 + (0.6215 * T_c) - (11.37 * Math.pow(V_kmh, 0.16)) + (0.3965 * T_c * Math.pow(V_kmh, 0.16));
        return windChill_c + 273.15; // Convert back to Kelvin for consistency before formatting
    }

    // Heat Index (for warm temperatures and humidity)
    // Steadman (1984) formula, simplified for Celsius
    // Valid for T_c >= 20°C and RH >= 40% (approx)
    if (T_c >= 20 && actualHumidity !== null) {
        const T_f = (T_c * 9/5) + 32; // Convert Celsius to Fahrenheit for heat index formula
        const RH = actualHumidity;

        // NOAA Heat Index formula (in Fahrenheit)
        let heatIndex_f = -42.379 + 2.04901523 * T_f + 10.14333127 * RH - 0.22475541 * T_f * RH - 0.00683783 * T_f * T_f - 0.05481717 * RH * RH + 0.00122874 * T_f * T_f * RH + 0.00085252 * T_f * RH * RH - 0.00000199 * T_f * T_f * RH * RH;

        // Adjustments for very low/high humidity (simplified)
        if (RH < 13 && T_f >= 80 && T_f <= 112) {
            heatIndex_f -= ((13 - RH) / 4) * Math.sqrt((17 - Math.abs(T_f - 95)) / 17);
        } else if (RH > 85 && T_f >= 80 && T_f <= 87) {
            heatIndex_f += ((RH - 85) / 10) * ((87 - T_f) / 5);
        }

        const heatIndex_c = (heatIndex_f - 32) * 5/9; // Convert back to Celsius
        return heatIndex_c + 273.15; // Convert back to Kelvin
    }

    // If neither wind chill nor heat index conditions are met, apparent temperature is just the air temperature
    return temperatureK;
};


// Main App component
const App = () => {
    // State variables for managing location, weather data, loading states, and errors
    const [location, setLocation] = useState('');
    const [weatherData, setWeatherData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [currentLocation, setCurrentLocation] = useState('');
    const [showLocationInput, setShowLocationInput] = useState(true);
    // New state for units: 'metric' or 'imperial'
    const [units, setUnits] = useState('metric'); // Default to metric
    // New states for search suggestions
    const [suggestions, setSuggestions] = useState([]);
    const debounceTimerRef = useRef(null); // Ref to hold the debounce timer
    // New state to store the timezone of the queried location
    const [locationTimeZone, setLocationTimeZone] = useState(null);


    // Mapping from Bright Sky icon names to more descriptive condition strings
    const iconToConditionMap = {
        'clear-day': 'Sunny',
        'clear-night': 'Clear',
        'partly-cloudy-day': 'Partly Cloudy',
        'partly-cloudy-night': 'Partly Cloudy',
        'cloudy': 'Cloudy',
        'fog': 'Foggy',
        'wind': 'Windy',
        'rain': 'Rainy',
        'sleet': 'Sleety',
        'snow': 'Snowy',
        'hail': 'Hail',
        'thunderstorm': 'Thunderstorm',
        'null': 'N/A', // Handle explicit 'null' icon
        'dry': 'Dry',
        'partly-cloudy': 'Partly Cloudy' // Generic partly cloudy
    };

    // Mapping from Bright Sky icon names to Lucide React components
    const iconNameToLucideComponent = {
        'clear-day': <Sun />,
        'clear-night': <Moon />,
        'partly-cloudy-day': <CloudSun />,
        'partly-cloudy-night': <CloudMoon />,
        'cloudy': <Cloud />,
        'fog': <CloudFog />,
        'wind': <Wind />,
        'rain': <CloudRain />,
        'sleet': <CloudSnow />, // Closest for sleet
        'snow': <Snowflake />,
        'hail': <CloudHail />,
        'thunderstorm': <CloudLightning />,
        'null': <HelpCircle />,
        'dry': <Sun />, // Assuming 'dry' implies sunny if no other icon
        'partly-cloudy': <CloudSun /> // Generic partly cloudy
    };

    // Mapping for background gradients based on weather icon
    const weatherBackgrounds = {
        'clear-day': 'from-blue-300 to-blue-500', // Sunny day
        'clear-night': 'from-indigo-800 to-purple-900', // Clear night
        'partly-cloudy-day': 'from-blue-200 to-blue-400', // Partly cloudy day
        'partly-cloudy-night': 'from-indigo-700 to-purple-800', // Partly cloudy night
        'cloudy': 'from-gray-400 to-gray-600', // Cloudy
        'fog': 'from-gray-300 to-gray-500', // Foggy
        'wind': 'from-blue-300 to-blue-500', // Windy (similar to clear day, or could be distinct)
        'rain': 'from-blue-600 to-blue-800', // Rainy
        'sleet': 'from-blue-500 to-gray-700', // Sleet
        'snow': 'from-blue-400 to-blue-600', // Snowy
        'hail': 'from-purple-600 to-indigo-800', // Hail
        'thunderstorm': 'from-gray-700 to-gray-900', // Thunderstorm
        'null': 'from-blue-400 to-purple-600', // Default if no icon
        'dry': 'from-blue-300 to-blue-500',
        'partly-cloudy': 'from-blue-200 to-blue-400'
    };

    // Define color themes for various elements based on weather icon
    const themedColors = {
        'clear-day': {
            mainCardBg: 'bg-yellow-100',
            mainTempText: 'text-yellow-800',
            mainConditionText: 'text-gray-700',
            detailCardBg: 'bg-yellow-50',
            detailText: 'text-yellow-700', // Actual value text color
            dailyCardBg: 'bg-yellow-50',
            dailyText: 'text-yellow-700', // Actual value text color
            hourlyCardBg: 'bg-yellow-50',
            hourlyText: 'text-yellow-700', // Actual value text color
            mainCardLabelText: 'text-gray-800', // Dark text for light main card background
            labelTextColor: 'text-gray-700', // Dark text for light detail/daily/hourly card backgrounds
            mainIconColor: 'text-yellow-600'
        },
        'clear-night': {
            mainCardBg: 'bg-indigo-900', // Background only
            mainTempText: 'text-purple-300',
            mainConditionText: 'text-gray-200',
            detailCardBg: 'bg-indigo-800', // Background only
            detailText: 'text-purple-200', // Actual value text color
            dailyCardBg: 'bg-indigo-800', // Background only
            dailyText: 'text-gray-100', // Ensures legibility on dark background
            hourlyCardBg: 'bg-indigo-800', // Background only
            hourlyText: 'text-purple-200', // Actual value text color
            mainCardLabelText: 'text-white', // Explicitly white for dark main card background
            labelTextColor: 'text-white', // Explicitly white for dark detail/daily/hourly card backgrounds
            mainIconColor: 'text-purple-300'
        },
        'partly-cloudy-day': {
            mainCardBg: 'bg-sky-100',
            mainTempText: 'text-sky-800',
            mainConditionText: 'text-gray-700',
            detailCardBg: 'bg-sky-50',
            detailText: 'text-sky-700',
            dailyCardBg: 'bg-sky-50',
            dailyText: 'text-sky-700',
            hourlyCardBg: 'bg-sky-50',
            hourlyText: 'text-sky-700',
            labelTextColor: 'text-gray-700',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-sky-600'
        },
        'partly-cloudy-night': {
            mainCardBg: 'bg-indigo-800', // Background only
            mainTempText: 'text-purple-200',
            mainConditionText: 'text-gray-200',
            detailCardBg: 'bg-indigo-700', // Background only
            detailText: 'text-purple-200',
            dailyCardBg: 'bg-indigo-700', // Only background
            dailyText: 'text-purple-200',
            hourlyCardBg: 'bg-indigo-700', // Only background
            hourlyText: 'text-purple-200',
            labelTextColor: 'text-white', // Explicitly white for dark backgrounds
            mainCardLabelText: 'text-white',
            mainIconColor: 'text-purple-300'
        },
        'cloudy': {
            mainCardBg: 'bg-gray-200',
            mainTempText: 'text-gray-800',
            mainConditionText: 'text-gray-700',
            detailCardBg: 'bg-gray-100',
            detailText: 'text-gray-700',
            dailyCardBg: 'bg-gray-100',
            dailyText: 'text-gray-800',
            hourlyCardBg: 'bg-gray-100',
            hourlyText: 'text-gray-700',
            labelTextColor: 'text-gray-800',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-gray-600'
        },
        'fog': {
            mainCardBg: 'bg-gray-100',
            mainTempText: 'text-gray-700',
            mainConditionText: 'text-gray-600',
            detailCardBg: 'bg-gray-50',
            detailText: 'text-gray-600',
            dailyCardBg: 'bg-gray-50',
            dailyText: 'text-gray-600',
            hourlyCardBg: 'bg-gray-50',
            hourlyText: 'text-gray-600',
            labelTextColor: 'text-gray-700',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-gray-500'
        },
        'wind': { // Similar to clear-day but could be adjusted
            mainCardBg: 'bg-blue-100',
            mainTempText: 'text-blue-700',
            mainConditionText: 'text-gray-700',
            detailCardBg: 'bg-blue-50',
            detailText: 'text-blue-700',
            dailyCardBg: 'bg-blue-50',
            dailyText: 'text-blue-700',
            hourlyCardBg: 'bg-blue-50',
            hourlyText: 'text-blue-700',
            labelTextColor: 'text-gray-700',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-blue-600'
        },
        'rain': {
            mainCardBg: 'bg-blue-200',
            mainTempText: 'text-blue-900',
            mainConditionText: 'text-gray-800',
            detailCardBg: 'bg-blue-100',
            detailText: 'text-blue-800',
            dailyCardBg: 'bg-blue-100',
            dailyText: 'text-blue-900',
            hourlyCardBg: 'bg-blue-100',
            hourlyText: 'text-blue-800',
            labelTextColor: 'text-gray-800',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-blue-800'
        },
        'sleet': {
            mainCardBg: 'bg-blue-300',
            mainTempText: 'text-blue-900',
            mainConditionText: 'text-gray-800',
            detailCardBg: 'bg-blue-200',
            detailText: 'text-blue-800',
            dailyCardBg: 'bg-blue-200',
            dailyText: 'text-blue-900',
            hourlyCardBg: 'bg-blue-200',
            hourlyText: 'text-blue-800',
            labelTextColor: 'text-gray-800',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-blue-800'
        },
        'snow': {
            mainCardBg: 'bg-blue-100',
            mainTempText: 'text-blue-800',
            mainConditionText: 'text-gray-700',
            detailCardBg: 'bg-blue-50',
            detailText: 'text-blue-700',
            dailyCardBg: 'bg-blue-50',
            dailyText: 'text-blue-800',
            hourlyCardBg: 'bg-blue-50',
            hourlyText: 'text-blue-700',
            labelTextColor: 'text-gray-700',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-blue-600'
        },
        'hail': {
            mainCardBg: 'bg-purple-200',
            mainTempText: 'text-purple-900',
            mainConditionText: 'text-gray-800',
            detailCardBg: 'bg-purple-100',
            detailText: 'text-purple-800',
            dailyCardBg: 'bg-purple-100',
            dailyText: 'text-purple-900',
            hourlyCardBg: 'bg-purple-100',
            hourlyText: 'text-purple-800',
            labelTextColor: 'text-gray-800',
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-purple-700'
        },
        'thunderstorm': {
            mainCardBg: 'bg-gray-800', // Background only
            mainTempText: 'text-yellow-400',
            mainConditionText: 'text-gray-100',
            detailCardBg: 'bg-gray-700', // Background only
            detailText: 'text-yellow-300',
            dailyCardBg: 'bg-gray-700', // Background only
            dailyText: 'text-yellow-400',
            hourlyCardBg: 'bg-gray-700', // Background only
            hourlyText: 'text-yellow-300',
            labelTextColor: 'text-white', // Explicitly white for dark backgrounds
            mainCardLabelText: 'text-white',
            mainIconColor: 'text-yellow-400'
        },
        // Default/null fallback theme
        'default': {
            mainCardBg: 'bg-blue-100',
            mainTempText: 'text-blue-700',
            mainConditionText: 'text-gray-700',
            detailCardBg: 'bg-blue-50',
            detailText: 'text-blue-700',
            dailyCardBg: 'bg-blue-50',
            dailyText: 'text-blue-700',
            hourlyCardBg: 'bg-blue-50',
            hourlyText: 'text-blue-700',
            labelTextColor: 'text-gray-800', // Default dark text for labels
            mainCardLabelText: 'text-gray-800',
            mainIconColor: 'text-blue-600'
        }
    };

    // Function to get themed classes based on current weather icon
    const getThemedClasses = (iconName) => {
        return themedColors[iconName] || themedColors.default;
    };


    // Function to get the background classes based on the current weather icon
    const getBackgroundClasses = (iconName) => {
        const defaultBackground = 'from-blue-400 to-purple-600'; // Fallback default
        return `bg-gradient-to-br ${weatherBackgrounds[iconName] || defaultBackground}`;
    };

    // Function to fetch coordinates and suggestions from Nominatim Geocoding API (OpenStreetMap)
    const getCoordinatesAndSuggestions = useCallback(async (query) => {
        if (query.length < 3) { // Only search for suggestions if query is at least 3 characters
            setSuggestions([]);
            return null;
        }
        try {
            const encodedQuery = encodeURIComponent(query);
            // Request up to 5 suggestions
            const nominatimApiUrl = `https://nominatim.openstreetmap.org/search?q=${encodedQuery}&format=json&limit=5`;

            // Nominatim requests a valid User-Agent
            const response = await fetch(nominatimApiUrl, {
                headers: {
                    'User-Agent': 'WeatherApp/1.0 (your-email@example.com)' // Replace with your app name and email
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Nominatim API error: ${response.status} - ${errorText}`);
            }
            const data = await response.json();
            // Extract timezone from Nominatim response
            const timezone = data.length > 0 && data[0].timezone ? data[0].timezone : null;
            setLocationTimeZone(timezone); // Store timezone in state

            setSuggestions(data); // Set suggestions for display
            if (data && data.length > 0) {
                // Return the first result as the primary coordinate for direct search if needed
                return {
                    lat: parseFloat(data[0].lat),
                    lon: parseFloat(data[0].lon),
                    display_name: data[0].display_name
                };
            } else {
                return null;
            }
        } catch (err) {
            console.error("Error fetching coordinates/suggestions:", err);
            setError(`Failed to get location suggestions: ${err.message}`);
            setSuggestions([]); // Clear suggestions on error
            return null;
        }
    }, []);

    // Function to fetch weather data from Bright Sky API
    const getWeatherData = useCallback(async (lat, lon) => {
        try {
            // Get today's date and a date for the next 7 days for forecast
            const today = new Date();
            const sevenDaysFromNow = new Date();
            sevenDaysFromNow.setDate(today.getDate() + 7); // Request data for today + next 7 full days

            const formatDate = (date) => {
                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                return `${year}-${month}-${day}`;
            };

            const formattedDate = formatDate(today);
            const formattedLastDate = formatDate(sevenDaysFromNow); // Request up to 7 full days

            // Bright Sky API base URL with required date parameters
            // Bright Sky returns temperature in Kelvin, other units are SI.
            let brightSkyApiUrl = `https://api.brightsky.dev/weather?lat=${lat}&lon=${lon}&date=${formattedDate}&last_date=${formattedLastDate}&units=si`;

            // Add timezone parameter if available
            if (locationTimeZone) {
                brightSkyApiUrl += `&tz=${locationTimeZone}`;
            }

            const response = await fetch(brightSkyApiUrl);
            if (!response.ok) {
                const errorText = await response.text();
                const errorJson = JSON.parse(errorText);
                if (errorJson.detail && errorJson.detail.includes("No sources match your criteria")) {
                    throw new Error("Weather data not available for this location or date range. Please try a different location.");
                }
                throw new Error(`Bright Sky API error: ${response.status} - ${errorText}`);
            }
            const data = await response.json();
            return data;
        } catch (err) {
            console.error("Error fetching weather data:", err);
            setError(`Failed to fetch weather data: ${err.message}`);
            return null;
        }
    }, [locationTimeZone]); // Added locationTimeZone to dependencies


    // Function to handle the search for weather data
    const handleSearch = useCallback(async (lat = null, lon = null, displayName = null) => {
        setLoading(true);
        setError(null);
        setWeatherData(null); // Clear previous weather data
        setSuggestions([]); // Clear suggestions after search

        let coords = null;
        if (lat && lon) { // If lat/lon are provided (e.g., from suggestion click)
            coords = { lat, lon, display_name: displayName };
        } else { // Otherwise, get coordinates from the current location input
            coords = await getCoordinatesAndSuggestions(location);
        }

        if (coords) {
            setCurrentLocation(coords.display_name);
            // Fetch weather data after timezone is potentially set by getCoordinatesAndSuggestions
            const weather = await getWeatherData(coords.lat, coords.lon);
            if (weather) {
                setWeatherData(weather);
                setShowLocationInput(false); // Hide input after successful search
            }
        }
        setLoading(false);
    }, [location, getCoordinatesAndSuggestions, getWeatherData]);

    // Handle input change with debouncing for suggestions
    const handleLocationInputChange = (e) => {
        const value = e.target.value;
        setLocation(value);
        setError(null); // Clear error when typing

        // Clear previous timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Set a new timer
        debounceTimerRef.current = setTimeout(() => {
            if (value.length >= 3) { // Only fetch suggestions if 3 or more characters
                getCoordinatesAndSuggestions(value);
            } else {
                setSuggestions([]); // Clear suggestions if less than 3 characters
            }
        }, 500); // 500ms debounce delay
    };

    // Handle click on a suggestion
    const handleSuggestionClick = (suggestion) => {
        setLocation(suggestion.display_name);
        setSuggestions([]); // Clear suggestions
        // Directly set timezone from suggestion if available
        if (suggestion.timezone) {
            setLocationTimeZone(suggestion.timezone);
        } else {
            setLocationTimeZone(null); // Clear if not provided
        }
        handleSearch(parseFloat(suggestion.lat), parseFloat(suggestion.lon), suggestion.display_name);
    };

    // Effect to handle pressing Enter key in the input field (for direct search without selecting suggestion)
    useEffect(() => {
        const handleKeyPress = (event) => {
            if (event.key === 'Enter' && location.trim() !== '' && suggestions.length === 0) {
                // Only trigger if no suggestions are currently shown (user intends a direct search)
                handleSearch();
            }
        };
        window.addEventListener('keypress', handleKeyPress);
        return () => {
            window.removeEventListener('keypress', handleKeyPress);
        };
    }, [location, suggestions, handleSearch]);

    // Function to convert temperature from Celsius to Fahrenheit
    const convertCelsiusToFahrenheit = (celsius) => {
        return (celsius * 9 / 5) + 32;
    };

    // Function to convert millimeters to inches
    const convertMmToInches = (mm) => {
        return mm / 25.4;
    };

    // Function to convert meters/second to kilometers/hour
    const convertMsToKmh = (ms) => {
        return ms * 3.6; // 1 m/s = 3.6 km/h
    };

    // Function to convert meters/second to miles/hour
    const convertMsToMph = (ms) => {
        return ms * 2.23694;
    };

    // Function to convert hectopascals to inches of mercury
    const convertHPaToInHg = (hPa) => {
        return hPa * 0.02953;
    };

    // Function to get cardinal wind direction from degrees
    const getCardinalDirection = (degrees) => {
        if (degrees === null || degrees === undefined) return '';
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round((degrees % 360) / 45);
        return directions[index % 8];
    };

    // Function to get formatted value based on current units
    const getFormattedValue = (value, type, rawData = null) => { // Added rawData parameter
        if (value === null || value === undefined) {
            // Attempt to calculate humidity if it's missing but dew_point and temperature are available
            if (type === 'humidity' && rawData && rawData.temperature !== null && rawData.dew_point !== null) {
                const calculatedRh = calculateRelativeHumidity(rawData.temperature, rawData.dew_point);
                if (calculatedRh !== null) {
                    return `${Math.round(calculatedRh)}%`;
                }
            }
            return 'N/A';
        }

        let processedValue = value;
        let unitSymbol = '';

        // Step 1: Convert temperature from Kelvin to Celsius if it's temperature type
        // Bright Sky provides temperature in Kelvin, so we always convert it to Celsius first.
        if (type === 'temperature') {
            processedValue = value - 273.15; // Convert Kelvin to Celsius
        }

        // Specific handling for pressure: assuming Bright Sky might return Pascals (Pa)
        // and converting to hPa for metric display.
        if (type === 'pressure') {
            // If the value is very large (e.g., 100,000+), assume it's in Pascals and convert to hPa
            // Otherwise, assume it's already in hPa. This is a heuristic based on observed error.
            if (value > 2000) { // A pressure value significantly higher than typical hPa (e.g., > 2000 hPa)
                processedValue = value / 100; // Convert Pa to hPa
            } else {
                processedValue = value; // Assume it's already hPa
            }
        }

        // Step 2: Apply unit-specific formatting based on 'units' state
        if (units === 'metric') {
            switch (type) {
                case 'temperature':
                    unitSymbol = '°C';
                    break;
                case 'precipitation':
                    unitSymbol = 'mm';
                    break;
                case 'wind_speed':
                    processedValue = convertMsToKmh(value); // Convert m/s to km/h
                    unitSymbol = 'km/h';
                    break;
                case 'pressure':
                    unitSymbol = 'hPa';
                    break;
                case 'visibility': // Added visibility type
                    processedValue = value / 1000; // meters to kilometers
                    unitSymbol = 'km';
                    break;
                case 'humidity':
                case 'cloud_cover': // Added cloud_cover type
                    unitSymbol = '%';
                    break;
                default:
                    break;
            }
        } else { // Imperial
            switch (type) {
                case 'temperature':
                    processedValue = convertCelsiusToFahrenheit(processedValue); // ProcessedValue is already Celsius
                    unitSymbol = '°F';
                    break;
                case 'precipitation':
                    processedValue = convertMmToInches(value); // Original value (mm) to inches
                    unitSymbol = 'in';
                    break;
                case 'wind_speed':
                    processedValue = convertMsToMph(value); // Original value (m/s) to mph
                    unitSymbol = 'mph';
                    break;
                case 'pressure':
                    processedValue = convertHPaToInHg(processedValue); // processedValue is already in hPa
                    unitSymbol = 'inHg';
                    break;
                case 'visibility': // Added visibility type
                    processedValue = (value / 1000) * 0.621371; // meters to miles
                    unitSymbol = 'mi';
                    break;
                case 'humidity':
                case 'cloud_cover': // Added cloud_cover type
                    unitSymbol = '%';
                    break;
                default:
                    break;
            }
        }
        // Round all numbers to whole numbers as requested
        return `${Math.round(processedValue)}${unitSymbol}`;
    };


    // Function to get a Lucide React component based on the 'icon' field from Bright Sky
    const getWeatherIcon = (iconName, size = 32, colorClass = 'text-gray-800') => { // Added colorClass parameter
        // Direct mapping to Lucide components, passing size and color as props
        const LucideIcon = iconNameToLucideComponent[iconName];
        if (LucideIcon) {
            return React.cloneElement(LucideIcon, { size, className: colorClass }); // Apply color class
        }
        return <HelpCircle size={size} className={colorClass} />; // Fallback to HelpCircle with color
    };


    // Function to process hourly data into daily forecast
    const getDailyForecast = useCallback((hourlyData) => {
        const dailyForecast = {};

        // Get the current date in the queried location's timezone
        const nowInLocationTimezone = new Date(new Date().toLocaleString('en-US', { timeZone: locationTimeZone || undefined }));
        // Normalize it to the start of the day
        nowInLocationTimezone.setHours(0, 0, 0, 0);

        hourlyData.forEach(hour => {
            const date = new Date(hour.timestamp);
            // Use local date string for grouping to avoid UTC/local day boundary issues
            const dateString = date.toLocaleDateString('en-US', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: locationTimeZone || undefined });

            if (!dailyForecast[dateString]) {
                dailyForecast[dateString] = {
                    date: date, // Keep original date for sorting, but use dateString for key
                    minTemp: Infinity, // Store in Kelvin initially
                    maxTemp: -Infinity, // Store in Kelvin initially
                    icons: {}, // To count icon occurrences
                    dominantIcon: null,
                    totalPrecipitation: 0
                };
            }

            // Update min/max temperature (store in Kelvin) only if temperature is a valid number
            if (typeof hour.temperature === 'number' && !isNaN(hour.temperature)) {
                if (hour.temperature < dailyForecast[dateString].minTemp) {
                    dailyForecast[dateString].minTemp = hour.temperature;
                }
                if (hour.temperature > dailyForecast[dateString].maxTemp) {
                    dailyForecast[dateString].maxTemp = hour.temperature;
                }
            }

            // Count icon occurrences, converting night icons to day icons for daily summary
            if (hour.icon) {
                let processedIcon = hour.icon;
                if (processedIcon.endsWith('-night')) {
                    processedIcon = processedIcon.replace('-night', '-day');
                }
                dailyForecast[dateString].icons[processedIcon] = (dailyForecast[dateString].icons[processedIcon] || 0) + 1;
            }

            // Sum precipitation
            dailyForecast[dateString].totalPrecipitation += hour.precipitation || 0;
        });

        // Determine dominant icon for each day
        for (const dateString in dailyForecast) {
            let maxCount = 0;
            let dominantIcon = null;
            for (const icon in dailyForecast[dateString].icons) {
                if (dailyForecast[dateString].icons[icon] > maxCount) {
                    maxCount = dailyForecast[dateString].icons[icon];
                    dominantIcon = icon;
                }
            }
            dailyForecast[dateString].dominantIcon = dominantIcon;

            // If minTemp or maxTemp are still Infinity/-Infinity, it means no valid temperature data was found for the day
            if (dailyForecast[dateString].minTemp === Infinity) {
                dailyForecast[dateString].minTemp = null;
            }
            if (dailyForecast[dateString].maxTemp === -Infinity) {
                dailyForecast[dateString].maxTemp = null;
            }
        }

        // Convert object to sorted array
        const sortedDailyForecast = Object.values(dailyForecast).sort((a, b) => a.date.getTime() - b.date.getTime());

        // Filter out days that are strictly before today in the location's timezone
        const filteredDailyForecast = sortedDailyForecast.filter(day => {
            const dayStartInLocationTimezone = new Date(day.date.toLocaleDateString('en-US', { timeZone: locationTimeZone || undefined }));
            dayStartInLocationTimezone.setHours(0, 0, 0, 0); // Normalize to midnight in local timezone
            return dayStartInLocationTimezone.getTime() >= nowInLocationTimezone.getTime();
        });

        // Slice to get exactly 7 days
        return filteredDailyForecast.slice(0, 7);
    }, [locationTimeZone]); // Added locationTimeZone to dependencies


    const currentHourWeather = weatherData ? getCurrentHourWeather(weatherData.weather) : null;
    const dailyForecastData = weatherData ? getDailyForecast(weatherData.weather) : [];
    const todayForecast = dailyForecastData.length > 0 ? dailyForecastData[0] : null;

    // Get themed classes based on current weather icon
    const theme = currentHourWeather ? getThemedClasses(currentHourWeather.icon) : themedColors.default;


    return (
        <div className={`min-h-screen flex items-center justify-center p-4 font-inter transition-colors duration-500 ${currentHourWeather ? getBackgroundClasses(currentHourWeather.icon) : 'bg-gradient-to-br from-blue-400 to-purple-600'}`}>
            <div className="bg-white bg-opacity-90 backdrop-blur-lg rounded-xl shadow-2xl p-8 max-w-2xl w-full border border-gray-200">
                <h1 className={`text-4xl font-extrabold text-center mb-6 drop-shadow-sm text-gray-800`}> {/* Always dark text for main title */}
                    SkyCast
                </h1>

                {showLocationInput ? (
                    <div className="flex flex-col space-y-4 relative">
                        <input
                            type="text"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-blue-500 focus:border-blue-500 transition duration-200 shadow-sm text-gray-700"
                            placeholder="Enter city or location"
                            value={location}
                            onChange={handleLocationInputChange}
                            aria-label="Location input"
                        />
                        {suggestions.length > 0 && (
                            <ul className="absolute z-10 w-full bg-white border border-gray-300 rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto">
                                {suggestions.map((suggestion) => (
                                    <li
                                        key={suggestion.place_id}
                                        className="p-3 cursor-pointer hover:bg-gray-100 border-b border-gray-200 text-gray-800"
                                        onClick={() => handleSuggestionClick(suggestion)}
                                    >
                                        {suggestion.display_name}
                                    </li>
                                ))}
                            </ul>
                        )}
                        <button
                            onClick={() => handleSearch()}
                            disabled={loading || location.trim() === ''}
                            className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition duration-300 ease-in-out shadow-md disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
                            aria-label="Search weather"
                        >
                            {loading ? (
                                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                </svg>
                            ) : (
                                'Get Weather'
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="text-center mb-4">
                        <h2 className={`text-2xl font-bold mb-2 text-gray-800`}>{currentLocation}</h2> {/* Always dark text for location name */}
                        <button
                            onClick={() => {
                                setShowLocationInput(true);
                                setWeatherData(null);
                                setLocation('');
                            }}
                            className="bg-gray-300 text-gray-800 py-2 px-4 rounded-lg font-semibold hover:bg-gray-400 transition duration-300 ease-in-out shadow-sm"
                        >
                            Change Location
                        </button>
                    </div>
                )}


                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg relative mt-6" role="alert">
                        <strong className="font-bold">Error!</strong>
                        <span className="block sm:inline"> {error}</span>
                    </div>
                )}

                {weatherData && weatherData.weather && weatherData.weather.length > 0 && currentHourWeather && (
                    <div className="mt-8">
                        {/* Unit Toggle */}
                        <div className="flex justify-center mb-4">
                            <button
                                onClick={() => setUnits('metric')}
                                className={`px-4 py-2 rounded-l-lg font-semibold transition duration-300 ease-in-out ${
                                    units === 'metric' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                            >
                                Metric
                            </button>
                            <button
                                onClick={() => setUnits('imperial')}
                                className={`px-4 py-2 rounded-r-lg font-semibold transition duration-300 ease-in-out ${
                                    units === 'imperial' ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                                }`}
                            >
                                Imperial
                            </button>
                        </div>

                        {/* Main Current Weather Display (mimicking Dark Sky) */}
                        <div className={`text-center mb-8 p-6 rounded-lg shadow-md ${theme.mainCardBg}`}>
                            <h2 className={`text-3xl font-bold mb-2 ${theme.mainCardLabelText}`}>Current Weather</h2> {/* Used mainCardLabelText */}
                            <p className={`text-6xl font-extrabold leading-none mb-2 ${theme.mainTempText}`}>
                                {getFormattedValue(currentHourWeather.temperature, 'temperature')}
                            </p>
                            <p className={`text-2xl mb-4 flex items-center justify-center gap-2 ${theme.mainConditionText}`}>
                                {iconToConditionMap[currentHourWeather.icon] || 'N/A'} {getWeatherIcon(currentHourWeather.icon, 48, theme.mainIconColor)} {/* Pass icon color */}
                            </p>
                            {/* Removed High/Low from here */}
                        </div>

                        {/* Detailed Current Weather Conditions */}
                        <h2 className={`text-2xl font-semibold mb-4 text-center text-gray-800`}>Details</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4"}
                            {/* High / Low */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Thermometer size={20} className={theme.labelTextColor} /> {/* Icon for High/Low */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>High / Low:</p>
                                </div>
                                <p className={`text-lg font-bold ${theme.detailText}`}>
                                    {todayForecast ? `${getFormattedValue(todayForecast.maxTemp, 'temperature')} / ${getFormattedValue(todayForecast.minTemp, 'temperature')}` : 'N/A'}
                                </p>
                            </div>
                            {/* Feels Like */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <ThermometerSun size={20} className={theme.labelTextColor} /> {/* Icon for Feels Like */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Feels Like:</p>
                                </div>
                                <p className={`text-lg font-bold ${theme.detailText}`}>
                                    {getFormattedValue(calculateApparentTemperature(currentHourWeather.temperature, currentHourWeather.humidity, currentHourWeather.wind_speed, currentHourWeather.dew_point), 'temperature')}
                                </p>
                            </div>
                            {/* Dew Point */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Droplet size={20} className={theme.labelTextColor} /> {/* Icon for Dew Point */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Dew Point:</p>
                                </div>
                                <p className={`text-lg font-bold ${theme.detailText}`}>
                                    {getFormattedValue(currentHourWeather.dew_point, 'temperature')}
                                </p>
                            </div>
                            {/* Humidity */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Droplet size={20} className={theme.labelTextColor} /> {/* Icon for Humidity */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Humidity:</p>
                                </div>
                                <p className={`text-xl font-bold break-words ${theme.detailText}`}>
                                    {getFormattedValue(currentHourWeather.humidity, 'humidity', currentHourWeather)}
                                </p>
                            </div>
                            {/* Wind Speed */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Wind size={20} className={theme.labelTextColor} /> {/* Icon for Wind Speed */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Wind:</p>
                                </div>
                                <p className={`text-lg font-bold ${theme.detailText}`}>
                                    {getFormattedValue(currentHourWeather.wind_speed, 'wind_speed')} {getCardinalDirection(currentHourWeather.wind_direction)}
                                    {currentHourWeather.wind_gust_speed !== null && currentHourWeather.wind_gust_speed !== undefined &&
                                        ` (G: ${getFormattedValue(currentHourWeather.wind_gust_speed, 'wind_speed')})`
                                    }
                                </p>
                            </div>
                            {/* Pressure */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Gauge size={20} className={theme.labelTextColor} /> {/* Icon for Pressure */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Pressure:</p>
                                </div>
                                <p className={`text-lg font-bold ${theme.detailText}`}>
                                    {getFormattedValue(currentHourWeather.pressure_msl, 'pressure')}
                                </p>
                            </div>
                            {/* Cloud Cover */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Cloud size={20} className={theme.labelTextColor} /> {/* Icon for Cloud Cover */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Cloud Cover:</p>
                                </div>
                                <p className={`text-xl font-bold break-words ${theme.detailText}`}>
                                    {getFormattedValue(currentHourWeather.cloud_cover, 'cloud_cover')}
                                </p>
                            </div>
                            {/* Visibility */}
                            <div className={`p-2 rounded-lg shadow-md ${theme.detailCardBg} flex items-center justify-between`}>
                                <div className="flex items-center gap-2">
                                    <Eye size={20} className={theme.labelTextColor} /> {/* Icon for Visibility */}
                                    <p className={`text-lg font-medium ${theme.labelTextColor}`}>Visibility:</p>
                                </div>
                                <p className={`text-lg font-bold ${theme.detailText}`}>
                                    {getFormattedValue(currentHourWeather.visibility, 'visibility')}
                                </p>
                            </div>
                        </div>

                        {/* Hourly Forecast */}
                        <h2 className={`text-2xl font-semibold mb-4 mt-8 text-center text-gray-800`}>Hourly Forecast</h2>
                        <div className="overflow-x-auto">
                            <div className="flex space-x-4 pb-4">
                                {
                                    // Filter out past hours and then take the next 24 hours
                                    weatherData.weather.filter(hour => {
                                        const hourTime = new Date(hour.timestamp);
                                        const currentTime = new Date();
                                        // Compare only hours and minutes to ensure current hour is included
                                        return hourTime.getTime() >= currentTime.setMinutes(currentTime.getMinutes() - 5); // Give a small buffer
                                    }).slice(0, 24).map((hour, index, array) => (
                                        <div key={index} className={`flex-shrink-0 w-32 p-4 rounded-lg shadow-md text-center ${theme.hourlyCardBg}`}>
                                            <p className={`text-sm font-semibold ${theme.labelTextColor}`}> {/* Used labelTextColor */}
                                                {/* Display day only if it's the first hour or the day changes from the previous hour */}
                                                {index === 0 || new Date(hour.timestamp).getDate() !== new Date(array[index - 1].timestamp).getDate()
                                                    ? new Date(hour.timestamp).toLocaleDateString('en-US', { weekday: 'short' }) + ' '
                                                    : ''
                                                }
                                                {new Date(hour.timestamp).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}
                                            </p>
                                            <div className="text-2xl mt-2 flex items-center justify-center">{getWeatherIcon(hour.icon, 32, theme.mainIconColor)}</div> {/* Pass icon color */}
                                            <p className={`text-xl font-bold mt-1 ${theme.hourlyText}`}>{getFormattedValue(hour.temperature, 'temperature')}</p>
                                            <p className={`text-sm ${theme.labelTextColor}`}>{iconToConditionMap[hour.icon] || 'N/A'}</p> {/* Used labelTextColor */}
                                        </div>
                                    ))
                                }
                            </div>
                        </div>

                        {/* Daily Forecast */}
                        <h2 className={`text-2xl font-semibold mb-4 mt-8 text-center text-gray-800`}>Daily Forecast</h2>
                        <div className="overflow-x-auto">
                            <div className="flex flex-col space-y-2 pb-4">
                                {dailyForecastData.map((day, index) => (
                                    <div key={index} className={`flex items-center justify-between p-4 rounded-lg shadow-md ${theme.dailyCardBg}`}>
                                        <p className={`text-lg font-semibold w-1/4 ${theme.labelTextColor}`}> {/* Used labelTextColor */}
                                            {day.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                                        </p>
                                        <div className="w-1/6 text-center flex items-center justify-center">{getWeatherIcon(day.dominantIcon, 32, theme.mainIconColor)}</div> {/* Pass icon color */}
                                        <p className={`text-lg w-1/3 text-center ${theme.labelTextColor}`}> {/* Used labelTextColor */}
                                            {iconToConditionMap[day.dominantIcon] || 'N/A'}
                                        </p>
                                        <p className={`text-lg font-bold w-1/4 text-right ${theme.dailyText}`}>
                                            {day.maxTemp !== null && day.minTemp !== null ?
                                                `${getFormattedValue(day.maxTemp, 'temperature')} / ${getFormattedValue(day.minTemp, 'temperature')}`
                                                : 'N/A'
                                            }
                                        </p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default App;
