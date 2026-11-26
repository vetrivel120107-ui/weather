
const $ = id => document.getElementById(id);

// Main Elements
const form = $("form");
const cityInput = $("city");
const searchBtn = $("searchBtn");
const locationBtn = $("locationBtn");
const refreshBtn = $("refreshBtn");
const unitToggle = $("unitToggle");
const statusText = $("status");
const weatherContent = $("weatherContent");

// Application State
let currentCity = null;
let currentWeatherData = null;
let currentAirData = null;
let currentCoordinates = null;
let comparisonData = null;

let isFahrenheit = false;
let countdownTimer = null;
let activeRequestId = 0;

// Search History
const HISTORY_KEY = "skycastHistory";
const MAX_HISTORY = 6;


// ==========================================
// 1. GENERAL HELPER FUNCTIONS
// ==========================================

function setStatus(message, type = "info") {
    if (!statusText) return;

    statusText.textContent = message;
    statusText.className = `status ${type}`;
}

function safeValue(value, fallback = "--") {
    if (
        value === null ||
        value === undefined ||
        value === "" ||
        !Number.isFinite(Number(value))
    ) {
        return fallback;
    }

    return value;
}

function updateText(id, value) {
    const element = $(id);

    if (element) {
        element.textContent = value;
    }
}

function convertTemperature(celsius) {
    if (celsius === null || celsius === undefined) {
        return null;
    }

    return isFahrenheit
        ? (Number(celsius) * 9 / 5) + 32
        : Number(celsius);
}

function temperatureUnit() {
    return isFahrenheit ? "°F" : "°C";
}

function formatTemperature(value) {
    const converted = convertTemperature(value);

    if (converted === null || !Number.isFinite(converted)) {
        return "--";
    }

    return `${Math.round(converted)}${temperatureUnit()}`;
}

function getWeatherInfo(code) {
    const weatherCodes = {
        0: ["Clear Sky", "☀️"],
        1: ["Mainly Clear", "🌤️"],
        2: ["Partly Cloudy", "⛅"],
        3: ["Overcast", "☁️"],

        45: ["Fog", "🌫️"],
        48: ["Depositing Rime Fog", "🌫️"],

        51: ["Light Drizzle", "🌦️"],
        53: ["Moderate Drizzle", "🌦️"],
        55: ["Dense Drizzle", "🌧️"],
        56: ["Freezing Drizzle", "🌧️"],
        57: ["Heavy Freezing Drizzle", "🌧️"],

        61: ["Slight Rain", "🌧️"],
        63: ["Moderate Rain", "🌧️"],
        65: ["Heavy Rain", "🌧️"],
        66: ["Freezing Rain", "🌧️"],
        67: ["Heavy Freezing Rain", "🌧️"],

        71: ["Slight Snow", "🌨️"],
        73: ["Moderate Snow", "❄️"],
        75: ["Heavy Snow", "❄️"],
        77: ["Snow Grains", "❄️"],

        80: ["Slight Rain Showers", "🌦️"],
        81: ["Moderate Rain Showers", "🌧️"],
        82: ["Violent Rain Showers", "⛈️"],

        85: ["Slight Snow Showers", "🌨️"],
        86: ["Heavy Snow Showers", "❄️"],

        95: ["Thunderstorm", "⛈️"],
        96: ["Thunderstorm with Hail", "⛈️"],
        99: ["Heavy Thunderstorm with Hail", "⛈️"]
    };

    return weatherCodes[code] || ["Unknown Weather", "🌡️"];
}

function formatDate(dateString) {
    if (!dateString) return "--";

    const date = new Date(`${dateString}T12:00:00`);

    if (Number.isNaN(date.getTime())) {
        return dateString;
    }

    return date.toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long"
    });
}

function formatTime(timeString) {
    if (!timeString) return "--";

    const timePart = timeString.split("T")[1];

    if (!timePart) return timeString;

    const [hours, minutes] = timePart.split(":");
    const hour = Number(hours);

    const period = hour >= 12 ? "PM" : "AM";
    const displayHour = hour % 12 || 12;

    return `${displayHour}:${minutes} ${period}`;
}


// ==========================================
// 2. API FETCH HELPER
// ==========================================

async function fetchAPI(url) {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`API Error: ${response.status}`);
    }

    return await response.json();
}


// ==========================================
// 3. CITY SEARCH / GEOCODING
// ==========================================

async function findCity(cityName) {
    const url =
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=10&language=en&format=json`;

    const data = await fetchAPI(url);

    if (!data.results || data.results.length === 0) {
        throw new Error("City not found. Please check the spelling.");
    }

    // Prefer capital / major administrative city
    const preferredCity = data.results.find(city =>
        ["PPLC", "PPLA", "PPLA2"].includes(city.feature_code)
    );

    const city = preferredCity || data.results[0];

    return {
        name: city.name,
        country: city.country || "",
        admin: city.admin1 || "",
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: city.timezone || "auto"
    };
}


// ==========================================
// 4. GET WEATHER DATA
// ==========================================

async function getWeather(latitude, longitude) {
    const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
        `&hourly=temperature_2m,relative_humidity_2m,precipitation_probability,weather_code,visibility,uv_index` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max` +
        `&timezone=auto&forecast_days=7`;

    return await fetchAPI(url);
}


// ==========================================
// 5. GET AIR QUALITY DATA
// ==========================================

async function getAirQuality(latitude, longitude) {
    const url =
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}` +
        `&current=us_aqi,pm10,pm2_5,ozone&timezone=auto`;

    return await fetchAPI(url);
}


// ==========================================
// 6. LOAD WEATHER BY COORDINATES
// ==========================================

async function loadWeatherByCoordinates(
    latitude,
    longitude,
    location,
    requestId = ++activeRequestId
) {
    try {
        setStatus("Getting live weather data...", "loading");

        const [weatherData, airData] = await Promise.all([
            getWeather(latitude, longitude),
            getAirQuality(latitude, longitude).catch(() => null)
        ]);

        // Ignore older requests
        if (requestId !== activeRequestId) return;

        if (!weatherData.current || !weatherData.daily) {
            throw new Error("Weather data is currently unavailable.");
        }

        currentWeatherData = weatherData;
        currentAirData = airData;

        currentCoordinates = {
            latitude,
            longitude
        };

        currentCity = location;

        // Continue with the main rendering function
        renderWeather();

        saveSearchHistory(location.name || "My Location");

        setStatus(
            `Weather updated for ${location.name || "My Location"}`,
            "success"
        );

    } catch (error) {
        if (requestId !== activeRequestId) return;

        console.error("Weather loading error:", error);

        setStatus(
            error.message || "Unable to load weather. Try again.",
            "error"
        );
    }
}


// ==========================================
// 7. LOAD WEATHER BY CITY NAME
// ==========================================

async function loadWeather(cityName) {
    if (!cityName || !cityName.trim()) {
        setStatus("Please enter a city name.", "error");
        return;
    }

    const requestId = ++activeRequestId;

    try {
        setStatus("Searching for city...", "loading");

        const city = await findCity(cityName.trim());

        if (requestId !== activeRequestId) return;

        await loadWeatherByCoordinates(
            city.latitude,
            city.longitude,
            city,
            requestId
        );

    } catch (error) {
        if (requestId !== activeRequestId) return;

        console.error("City search error:", error);

        setStatus(
            error.message || "Unable to find this city.",
            "error"
        );
    }
}


// ==========================================
// 8. CURRENT LOCATION
// ==========================================
async function getCurrentLocation() {
    if (!navigator.geolocation) {
        setStatus(
            "Your browser does not support location access.",
            "error"
        );
        return;
    }

    setStatus("Getting your current location...", "loading");

    navigator.geolocation.getCurrentPosition(
        async position => {
            const latitude = position.coords.latitude;
            const longitude = position.coords.longitude;

            // Default location
            let location = {
                name: "My Location",
                country: "",
                admin: "",
                latitude,
                longitude,
                timezone: "auto"
            };

            try {
                // Convert coordinates into city name
                const response = await fetch(
                    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=en`
                );

                if (!response.ok) {
                    throw new Error("Location lookup failed");
                }

                const data = await response.json();

                const cityName =
                    data.city ||
                    data.locality ||
                    data.localityInfo?.administrative?.[0]?.name;

                location = {
                    name: cityName || "My Location",
                    country: data.countryName || "",
                    admin: data.principalSubdivision || "",
                    latitude,
                    longitude,
                    timezone: "auto"
                };

            } catch (error) {
                console.log("City name lookup failed:", error);
            }

            // Load weather even if city name lookup fails
            loadWeatherByCoordinates(
                latitude,
                longitude,
                location
            );
        },

        error => {
            let message = "Unable to get your location.";

            if (error.code === 1) {
                message = "Please allow location permission.";
            } else if (error.code === 2) {
                message = "Your location is unavailable.";
            } else if (error.code === 3) {
                message = "Location request timed out.";
            }

            setStatus(message, "error");
        },

        {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 300000
        }
    );
}
// ==========================================
// 9. MAIN WEATHER RENDER FUNCTION
// ==========================================

function renderWeather() {
    if (!currentWeatherData) return;

    if (weatherContent) {
        weatherContent.hidden = false;
    }

    renderCurrentWeather();
    renderHourlyForecast();
    renderTemperatureChart();
    renderDailyForecast();
    renderWeatherDetails();
    renderAirQuality();
    renderActivities();
    renderAdvisor();
    renderSunTimes();
    renderWeatherInsights();
    updateWeatherBackground();

    if (comparisonData) {
        renderComparison();
    }

    updateShareCard();
}


// ==========================================
// 10. CURRENT WEATHER
// ==========================================

function renderCurrentWeather() {
    const data = currentWeatherData;
    const current = data.current;
    const daily = data.daily;

    const [description, icon] =
        getWeatherInfo(current.weather_code);

    const cityName = currentCity?.name || "My Location";
    const country = currentCity?.country || "";

    updateText(
        "placeName",
        country ? `${cityName}, ${country}` : cityName
    );

    updateText(
        "localDate",
        formatDate(current.time?.split("T")[0])
    );

    updateText("heroIcon", icon);
    updateText("temperature", formatTemperature(current.temperature_2m));
    updateText("degreeMark", temperatureUnit());
    updateText("condition", description);

    updateText(
        "feelsLike",
        `Feels like ${formatTemperature(current.apparent_temperature)}`
    );

    updateText(
        "todayHigh",
        formatTemperature(daily.temperature_2m_max?.[0])
    );

    updateText(
        "todayLow",
        formatTemperature(daily.temperature_2m_min?.[0])
    );

    updateText(
        "rainChance",
        `${safeValue(daily.precipitation_probability_max?.[0])}%`
    );
}


// ==========================================
// 11. FIND CURRENT HOURLY INDEX
// ==========================================

function findNearestHourIndex(data) {
    const times = data?.hourly?.time || [];
    const currentTime = data?.current?.time;

    if (!times.length || !currentTime) return 0;

    const index = times.findIndex(time => time >= currentTime);

    return index === -1 ? times.length - 1 : index;
}


// ==========================================
// 12. HOURLY FORECAST
// ==========================================

function renderHourlyForecast() {
    const container = $("hourlyForecast");

    if (!container) return;

    container.replaceChildren();

    const hourly = currentWeatherData.hourly;
    const startIndex = findNearestHourIndex(currentWeatherData);

    const endIndex = Math.min(
        startIndex + 24,
        hourly.time.length
    );

    for (let i = startIndex; i < endIndex; i++) {
        const item = document.createElement("div");
        item.className = "hourly-item";

        const time = document.createElement("span");
        time.className = "hourly-time";

        time.textContent =
            i === startIndex
                ? "Now"
                : formatTime(hourly.time[i]);

        const icon = document.createElement("span");
        icon.className = "hourly-icon";

        icon.textContent =
            getWeatherInfo(hourly.weather_code[i])[1];

        const temperature = document.createElement("span");
        temperature.className = "hourly-temp";

        temperature.textContent =
            formatTemperature(hourly.temperature_2m[i]);

        const rain = document.createElement("small");

        rain.textContent =
            `${safeValue(hourly.precipitation_probability?.[i], 0)}% rain`;

        item.append(time, icon, temperature, rain);
        container.appendChild(item);
    }
}


// ==========================================
// 13. TEMPERATURE CHART
// ==========================================

function renderTemperatureChart() {
    const data = currentWeatherData;
    const hourly = data.hourly;

    const chartLine = $("chartLine");
    const chartFill = $("chartFill");
    const chartDots = $("chartDots");

    if (!chartLine || !chartFill || !chartDots) return;

    const startIndex = findNearestHourIndex(data);
    const endIndex = Math.min(
        startIndex + 12,
        hourly.temperature_2m.length
    );

    const temperatures =
        hourly.temperature_2m.slice(startIndex, endIndex);

    if (temperatures.length < 2) return;

    const values = temperatures.map(convertTemperature);

    const minTemp = Math.min(...values) - 3;
    const maxTemp = Math.max(...values) + 3;

    const width = 600;
    const height = 180;
    const padding = 25;

    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;

    const points = values.map((temp, index) => {
        const x =
            padding +
            (index / (values.length - 1)) * chartWidth;

        const y =
            height - padding -
            ((temp - minTemp) / (maxTemp - minTemp)) *
            chartHeight;

        return { x, y, temp };
    });

    const linePath = points.map((point, index) =>
        `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
    ).join(" ");

    chartLine.setAttribute("d", linePath);

    const areaPath =
        `${linePath} L ${points[points.length - 1].x} ${height - padding}` +
        ` L ${points[0].x} ${height - padding} Z`;

    chartFill.setAttribute("d", areaPath);

    chartDots.replaceChildren();

    points.forEach((point, index) => {
        const circle = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "circle"
        );

        circle.setAttribute("cx", point.x);
        circle.setAttribute("cy", point.y);
        circle.setAttribute("r", "4");
        circle.setAttribute("class", "chart-dot");

        chartDots.appendChild(circle);

        if (index % 2 === 0) {
            const label = document.createElementNS(
                "http://www.w3.org/2000/svg",
                "text"
            );

            label.setAttribute("x", point.x);
            label.setAttribute("y", point.y - 12);
            label.setAttribute("text-anchor", "middle");
            label.setAttribute("class", "chart-label");

            label.textContent =
                `${Math.round(point.temp)}°`;

            chartDots.appendChild(label);
        }
    });
}


// ==========================================
// 14. SEVEN DAY FORECAST
// ==========================================

function renderDailyForecast() {
    const container = $("dailyForecast");

    if (!container) return;

    container.replaceChildren();

    const daily = currentWeatherData.daily;

    for (let i = 0; i < daily.time.length; i++) {
        const row = document.createElement("div");
        row.className = "daily-row";

        const day = document.createElement("span");
        day.className = "daily-day";

        if (i === 0) {
            day.textContent = "Today";
        } else {
            const date = new Date(`${daily.time[i]}T12:00:00`);

            day.textContent = date.toLocaleDateString("en-IN", {
                weekday: "short"
            });
        }

        const weatherIcon = document.createElement("span");
        weatherIcon.className = "daily-icon";

        const [description, icon] =
            getWeatherInfo(daily.weather_code[i]);

        weatherIcon.textContent = icon;

        const condition = document.createElement("span");
        condition.className = "daily-condition";
        condition.textContent = description;

        const rain = document.createElement("span");
        rain.className = "daily-rain";

        rain.textContent =
            `${safeValue(daily.precipitation_probability_max?.[i], 0)}%`;

        const temperature = document.createElement("span");
        temperature.className = "daily-temp";

        temperature.textContent =
            `${formatTemperature(daily.temperature_2m_min[i])} / ` +
            `${formatTemperature(daily.temperature_2m_max[i])}`;

        row.append(
            day,
            weatherIcon,
            condition,
            rain,
            temperature
        );

        container.appendChild(row);
    }
}


// ==========================================
// 15. WEATHER DETAILS
// ==========================================

function renderWeatherDetails() {
    const current = currentWeatherData.current;
    const hourly = currentWeatherData.hourly;
    const daily = currentWeatherData.daily;

    const index = findNearestHourIndex(currentWeatherData);

    updateText(
        "detailFeels",
        formatTemperature(current.apparent_temperature)
    );

    updateText(
        "humidity",
        `${safeValue(current.relative_humidity_2m)}%`
    );

    updateText(
        "wind",
        `${safeValue(current.wind_speed_10m)} km/h`
    );

    updateText(
        "windDirection",
        `${safeValue(current.wind_direction_10m)}°`
    );

    const uv = hourly.uv_index?.[index];

    updateText("uv", safeValue(uv));

    let uvHint = "Low";

    if (uv >= 3 && uv < 6) uvHint = "Moderate";
    else if (uv >= 6 && uv < 8) uvHint = "High";
    else if (uv >= 8 && uv < 11) uvHint = "Very High";
    else if (uv >= 11) uvHint = "Extreme";

    updateText("uvHint", uvHint);

    const visibility = hourly.visibility?.[index];

    updateText(
        "visibility",
        visibility !== undefined && visibility !== null
            ? `${(visibility / 1000).toFixed(1)} km`
            : "--"
    );

    updateText(
        "pressure",
        `${safeValue(current.pressure_msl)} hPa`
    );

    updateText(
        "sunrise",
        formatTime(daily.sunrise?.[0])
    );

    updateText(
        "sunset",
        formatTime(daily.sunset?.[0])
    );
}


// ==========================================
// 16. AIR QUALITY INDEX
// ==========================================

function renderAirQuality() {
    const data = currentAirData?.current;

    if (!data) {
        updateText("aqi", "--");
        updateText("aqiLabel", "Unavailable");
        updateText("pm25", "--");
        updateText("pm10", "--");
        updateText("ozone", "--");
        updateText("airAdvice", "Air quality data is unavailable.");

        const meter = $("aqiMeterFill");
        if (meter) meter.style.width = "0%";

        return;
    }

    const aqi = Number(data.us_aqi);

    let label = "Hazardous";

    if (aqi <= 50) label = "Good";
    else if (aqi <= 100) label = "Moderate";
    else if (aqi <= 150) label = "Unhealthy for Sensitive Groups";
    else if (aqi <= 200) label = "Unhealthy";
    else if (aqi <= 300) label = "Very Unhealthy";

    updateText("aqi", safeValue(data.us_aqi));
    updateText("aqiLabel", label);

    updateText("pm25", safeValue(data.pm2_5));
    updateText("pm10", safeValue(data.pm10));
    updateText("ozone", safeValue(data.ozone));

    const meter = $("aqiMeterFill");

    if (meter) {
        meter.style.width =
            `${Math.min(100, Math.max(0, (aqi / 300) * 100))}%`;
    }

    let advice = "Air quality is good. Enjoy outdoor activities.";

    if (aqi > 50 && aqi <= 100) {
        advice = "Sensitive people should monitor air quality.";
    } else if (aqi > 100 && aqi <= 150) {
        advice = "Sensitive groups should reduce prolonged outdoor activity.";
    } else if (aqi > 150 && aqi <= 200) {
        advice = "Consider reducing outdoor activities.";
    } else if (aqi > 200) {
        advice = "Avoid prolonged outdoor exposure where possible.";
    }

    updateText("airAdvice", advice);
}
// ==========================================
// 17. ACTIVITY SUGGESTIONS
// ==========================================

function renderActivities() {
    const container = $("activityGrid");

    if (!container) return;

    container.replaceChildren();

    const current = currentWeatherData.current;
    const daily = currentWeatherData.daily;

    const temperature = Number(current.temperature_2m);
    const wind = Number(current.wind_speed_10m);
    const rain = Number(daily.precipitation_probability_max?.[0] || 0);
    const code = Number(current.weather_code);

    const activities = [];

    if (temperature >= 18 && temperature <= 30 && rain < 40 && wind < 30) {
        activities.push({
            icon: "🚶",
            title: "Walking",
            status: "Great",
            description: "Comfortable conditions for a walk."
        });
    } else {
        activities.push({
            icon: "🚶",
            title: "Walking",
            status: "Check Conditions",
            description: "Check rain and wind before heading out."
        });
    }

    if (rain < 30 && wind < 25 && temperature >= 15) {
        activities.push({
            icon: "🚴",
            title: "Cycling",
            status: "Good",
            description: "Weather looks suitable for cycling."
        });
    } else {
        activities.push({
            icon: "🚴",
            title: "Cycling",
            status: "Limited",
            description: "Consider checking outdoor conditions first."
        });
    }

    if (rain < 30 && wind < 30) {
        activities.push({
            icon: "🏏",
            title: "Outdoor Sports",
            status: "Good",
            description: "Outdoor games may be enjoyable."
        });
    } else {
        activities.push({
            icon: "🏏",
            title: "Outdoor Sports",
            status: "Not Ideal",
            description: "Rain or wind may affect outdoor games."
        });
    }

    if (temperature >= 32 || code >= 61) {
        activities.push({
            icon: "🏠",
            title: "Indoor Activities",
            status: "Recommended",
            description: "Indoor activities may be more comfortable."
        });
    } else {
        activities.push({
            icon: "🌳",
            title: "Outdoor Time",
            status: "Suitable",
            description: "Consider spending some time outdoors."
        });
    }

    activities.forEach(activity => {
        const card = document.createElement("div");
        card.className = "activity-card";

        const icon = document.createElement("span");
        icon.className = "activity-icon";
        icon.textContent = activity.icon;

        const info = document.createElement("div");
        info.className = "activity-info";

        const title = document.createElement("strong");
        title.textContent = activity.title;

        const description = document.createElement("p");
        description.textContent = activity.description;

        const status = document.createElement("span");
        status.className = "activity-status";
        status.textContent = activity.status;

        info.append(title, description, status);
        card.append(icon, info);

        container.appendChild(card);
    });
}


// ==========================================
// 18. OUTFIT & UMBRELLA ADVISOR
// ==========================================

function renderAdvisor() {
    const current = currentWeatherData.current;
    const daily = currentWeatherData.daily;

    const temperature = Number(current.temperature_2m);
    const rain = Number(daily.precipitation_probability_max?.[0] || 0);
    const code = Number(current.weather_code);

    let outfitIcon = "👕";
    let outfitAdvice = "Light and comfortable clothing is suitable.";

    if (temperature < 10) {
        outfitIcon = "🧥";
        outfitAdvice = "Wear warm clothes and a jacket.";
    } else if (temperature < 18) {
        outfitIcon = "🧥";
        outfitAdvice = "A light jacket may be comfortable.";
    } else if (temperature >= 32) {
        outfitIcon = "👕";
        outfitAdvice = "Wear light cotton clothes and stay hydrated.";
    } else if (temperature >= 25) {
        outfitIcon = "👕";
        outfitAdvice = "Choose breathable and comfortable clothes.";
    }

    updateText("outfitIcon", outfitIcon);
    updateText("outfitAdvice", outfitAdvice);

    const rainyWeather = code >= 51 && code <= 99;
    const needsUmbrella = rain >= 40 || rainyWeather;

    updateText(
        "umbrellaIcon",
        needsUmbrella ? "☂️" : "🌤️"
    );

    updateText(
        "umbrellaAdvice",
        needsUmbrella
            ? "Carry an umbrella or raincoat."
            : "An umbrella may not be necessary."
    );

    let outdoorAdvice = "Enjoy your day and stay comfortable.";

    if (temperature >= 35) {
        outdoorAdvice = "Avoid prolonged exposure to direct sunlight.";
    } else if (rain >= 60) {
        outdoorAdvice = "Rain is possible. Plan outdoor activities carefully.";
    } else if (Number(current.wind_speed_10m) >= 40) {
        outdoorAdvice = "Strong winds are possible. Take care outdoors.";
    }

    updateText("outdoorAdvice", outdoorAdvice);
}


// ==========================================
// 19. SUNRISE & SUNSET COUNTDOWN
// ==========================================

function parseLocalDateTime(value) {
    if (!value) return null;

    const match = value.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
    );

    if (!match) return null;

    const [, year, month, day, hour, minute] = match;

    return Date.UTC(
        Number(year),
        Number(month) - 1,
        Number(day),
        Number(hour),
        Number(minute)
    );
}

function getCountdownText(targetTime, currentTime) {
    const target = parseLocalDateTime(targetTime);
    const now = parseLocalDateTime(currentTime);

    if (target === null || now === null) {
        return "--";
    }

    let difference = target - now;

    if (difference < 0) {
        difference += 24 * 60 * 60 * 1000;
    }

    const totalMinutes = Math.floor(difference / 60000);

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return `${hours}h ${minutes}m`;
}

function renderSunTimes() {
    const daily = currentWeatherData.daily;

    updateText(
        "sunriseTime",
        formatTime(daily.sunrise?.[0])
    );

    updateText(
        "sunsetTime",
        formatTime(daily.sunset?.[0])
    );

    updateSunCountdowns();

    if (countdownTimer) {
        clearInterval(countdownTimer);
    }

    countdownTimer = setInterval(() => {
        if (currentWeatherData) {
            updateSunCountdowns();
        }
    }, 60000);
}

function updateSunCountdowns() {
    if (!currentWeatherData) return;

    const daily = currentWeatherData.daily;
    const current = currentWeatherData.current;

    const sunrise = daily.sunrise?.[0];
    const sunset = daily.sunset?.[0];

    updateText(
        "sunriseCountdown",
        getCountdownText(sunrise, current.time)
    );

    updateText(
        "sunsetCountdown",
        getCountdownText(sunset, current.time)
    );
}


// ==========================================
// 20. WEATHER INSIGHTS
// ==========================================

function renderWeatherInsights() {
    const container = $("weatherAlerts");

    if (!container) return;

    container.replaceChildren();

    const current = currentWeatherData.current;
    const daily = currentWeatherData.daily;
    const hourly = currentWeatherData.hourly;

    const temperature = Number(current.temperature_2m);
    const wind = Number(current.wind_speed_10m);
    const rain = Number(daily.precipitation_probability_max?.[0] || 0);

    const index = findNearestHourIndex(currentWeatherData);
    const uv = Number(hourly.uv_index?.[index] || 0);

    const insights = [];

    if (rain >= 60) {
        insights.push({
            icon: "🌧️",
            title: "Rain Expected",
            message: `Forecast indicates a ${rain}% chance of precipitation today.`
        });
    }

    if (temperature >= 35) {
        insights.push({
            icon: "🌡️",
            title: "High Temperature",
            message: "High temperatures are forecast. Drink enough water and seek shade."
        });
    }

    if (wind >= 40) {
        insights.push({
            icon: "💨",
            title: "Strong Winds",
            message: "Wind speeds are elevated. Take care during outdoor activities."
        });
    }

    if (uv >= 8) {
        insights.push({
            icon: "☀️",
            title: "High UV Index",
            message: "Use sun protection when spending time outdoors."
        });
    }

    if (insights.length === 0) {
        insights.push({
            icon: "✨",
            title: "Weather Looks Stable",
            message: "No significant weather concerns detected from the available forecast."
        });
    }

    const note = document.createElement("p");
    note.className = "insight-note";
    note.textContent =
        "These are forecast-based insights, not official weather warnings.";

    container.appendChild(note);

    insights.forEach(insight => {
        const card = document.createElement("div");
        card.className = "weather-alert";

        const icon = document.createElement("span");
        icon.textContent = insight.icon;

        const content = document.createElement("div");

        const title = document.createElement("strong");
        title.textContent = insight.title;

        const message = document.createElement("p");
        message.textContent = insight.message;

        content.append(title, message);
        card.append(icon, content);

        container.appendChild(card);
    });
}


// ==========================================
// 21. ANIMATED WEATHER BACKGROUND
// ==========================================
function updateWeatherBackground() {
    if (!currentWeatherData) return;

    const current = currentWeatherData.current;
    const code = Number(current.weather_code);
    const isDay = Number(current.is_day) === 1;

    document.body.classList.toggle("night-mode", !isDay);

    let effect = "clear";

    // Thunderstorm
    if (code >= 95) {
        effect = "storm";
    }

    // Snow
    else if (
        (code >= 71 && code <= 77) ||
        code === 85 ||
        code === 86
    ) {
        effect = "snow";
    }

    // Rain
    else if (
        (code >= 51 && code <= 67) ||
        (code >= 80 && code <= 82)
    ) {
        effect = "rain";
    }

    // Cloudy
    else if (
        code === 2 ||
        code === 3 ||
        code === 45 ||
        code === 48
    ) {
        effect = "cloud";
    }

    // Sunny / Mostly clear
    else if (
        isDay &&
        (code === 0 || code === 1)
    ) {
        effect = "sunny";
    }

    let particles = $("weatherParticles");

    if (!particles) {
        particles = document.createElement("div");
        particles.id = "weatherParticles";

        particles.style.position = "fixed";
        particles.style.inset = "0";
        particles.style.pointerEvents = "none";
        particles.style.overflow = "hidden";
        particles.style.zIndex = "0";

        document.body.prepend(particles);
    }

    // Reset previous effect
    particles.replaceChildren();
    particles.className = `${effect}-effect`;

    // Particle count
    const counts = {
        rain: 35,
        snow: 30,
        storm: 40,
        cloud: 12,
        sunny: 1,
        clear: 0
    };

    const count = counts[effect];

    for (let i = 0; i < count; i++) {
        const particle = document.createElement("span");

        // Correct CSS selector structure
        particle.className = "weather-particle";

        particle.style.position = "absolute";

        if (effect === "sunny") {
            particle.style.left = "82%";
            particle.style.top = "12%";
        } else {
            particle.style.left = `${Math.random() * 100}%`;
            particle.style.top = `${Math.random() * 100}%`;
        }

        particle.style.animationDelay =
            `${Math.random() * 5}s`;
particle.style.animationDuration =
    effect === "snow"
        ? `${4 + Math.random() * 5}s`
        : effect === "rain" || effect === "storm"
            ? `${0.5 + Math.random() * 1.5}s`
            : `${5 + Math.random() * 10}s`;

        particles.appendChild(particle);
    }
}

// ==========================================
// 22. CITY COMPARISON
// ==========================================

async function compareCityWeather() {
    const input = $("compareCity");

    if (!input || !input.value.trim()) {
        updateText("compareStatus", "Enter a city to compare.");
        return;
    }

    const button = $("compareBtn");

    if (button) button.disabled = true;

    updateText("compareStatus", "Loading comparison...");

    try {
        const city = await findCity(input.value.trim());

        const weather = await getWeather(
            city.latitude,
            city.longitude
        );

        comparisonData = {
            city,
            weather
        };

        renderComparison();

        updateText("compareStatus", "Comparison updated.");

    } catch (error) {
        console.error("Comparison error:", error);

        updateText(
            "compareStatus",
            error.message || "Unable to compare this city."
        );

    } finally {
        if (button) button.disabled = false;
    }
}

function renderComparison() {
    const container = $("comparisonResult");

    if (!container || !comparisonData || !currentWeatherData) {
        return;
    }

    container.replaceChildren();

    const cities = [
        {
            city: currentCity,
            weather: currentWeatherData
        },
        comparisonData
    ];

    const temperatures = cities.map(item =>
        Number(item.weather.current.temperature_2m)
    );
const difference = Math.abs(
    convertTemperature(temperatures[0]) -
    convertTemperature(temperatures[1])
);

    cities.forEach((item, index) => {
        const current = item.weather.current;

        const [description, icon] =
            getWeatherInfo(current.weather_code);

        const card = document.createElement("div");
        card.className = "comparison-card";

        const name = document.createElement("h3");
        name.textContent = item.city.name || "My Location";

        const weatherIcon = document.createElement("div");
        weatherIcon.className = "comparison-icon";
        weatherIcon.textContent = icon;

        const temperature = document.createElement("div");
        temperature.className = "comparison-temperature";
        temperature.textContent =
            formatTemperature(current.temperature_2m);

        const summary = document.createElement("p");
        summary.className = "comparison-summary";
        summary.textContent = description;

        const humidity = document.createElement("p");
        humidity.textContent =
            `Humidity: ${safeValue(current.relative_humidity_2m)}%`;

        const wind = document.createElement("p");
        wind.textContent =
            `Wind: ${safeValue(current.wind_speed_10m)} km/h`;

        card.append(
            name,
            weatherIcon,
            temperature,
            summary,
            humidity,
            wind
        );

        container.appendChild(card);
    });

    const result = document.createElement("p");

   result.textContent =
    `Temperature difference: ${difference.toFixed(1)}${temperatureUnit()}`;
    container.appendChild(result);
}


// ==========================================
// 23. SEARCH HISTORY
// ==========================================

function getSearchHistory() {
    try {
        const history = JSON.parse(
            localStorage.getItem(HISTORY_KEY) || "[]"
        );

        return Array.isArray(history) ? history : [];

    } catch {
        return [];
    }
}

function saveSearchHistory(cityName) {
    if (!cityName) return;

    try {
        let history = getSearchHistory();

        history = history.filter(
            name => name.toLowerCase() !== cityName.toLowerCase()
        );

        history.unshift(cityName);

        history = history.slice(0, MAX_HISTORY);

        localStorage.setItem(
            HISTORY_KEY,
            JSON.stringify(history)
        );

        renderHistory();

    } catch (error) {
        console.warn("Unable to save search history:", error);
    }
}

function renderHistory() {
    const container = $("historyList");

    if (!container) return;

    container.replaceChildren();

    const history = getSearchHistory();

    if (history.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "No recent searches yet.";
        container.appendChild(empty);
        return;
    }

    history.forEach(city => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "history-item";
        button.textContent = `📍 ${city}`;

        button.addEventListener("click", () => {
            if (city === "My Location" && currentCoordinates) {
                loadWeatherByCoordinates(
                    currentCoordinates.latitude,
                    currentCoordinates.longitude,
                    currentCity
                );
            } else {
                if (cityInput) cityInput.value = city;
                loadWeather(city);
            }
        });

        container.appendChild(button);
    });
}

function clearSearchHistory() {
    try {
        localStorage.removeItem(HISTORY_KEY);
    } catch (error) {
        console.warn("Unable to clear history:", error);
    }

    renderHistory();
}


// ==========================================
// 24. SHARE WEATHER CARD
// ==========================================
function updateShareCard() {
    if (!currentWeatherData || !currentWeatherData.current) return;

    const current = currentWeatherData.current;
    const city = currentCity;

    const [description, icon] =
        getWeatherInfo(current.weather_code);

    // City
    const cityName = city?.name || "My Location";
    const country = city?.country || "";

    updateText(
        "shareCity",
        country ? `${cityName}, ${country}` : cityName
    );

    // Main Weather
    updateText("shareIcon", icon);

    updateText(
        "shareTemp",
        formatTemperature(current.temperature_2m)
    );

    updateText("shareCondition", description);

    // Date
    updateText(
        "shareDate",
        formatDate(current.time?.split("T")[0])
    );

    // Weather Details
    updateText(
        "shareFeels",
        formatTemperature(current.apparent_temperature)
    );

    updateText(
        "shareHumidity",
        `${safeValue(current.relative_humidity_2m)}%`
    );

    updateText(
        "shareWind",
        `${safeValue(current.wind_speed_10m)} km/h`
    );
}

// ==========================================
// 25. DOWNLOAD WEATHER CARD
// ==========================================

async function downloadWeatherCard() {
    const card = $("shareCard");
    const button = $("downloadCard");

    if (!card || !currentWeatherData) {
        setStatus("Load weather before downloading.", "error");
        return;
    }

    if (typeof html2canvas !== "function") {
        setStatus("Download library is unavailable.", "error");
        return;
    }

    const originalText = button?.textContent;

    try {
        if (button) {
            button.disabled = true;
            button.textContent = "Preparing...";
        }

        const canvas = await html2canvas(card, {
            backgroundColor: "#102b4b",
            scale: 2,
            useCORS: true
        });

        const link = document.createElement("a");

        link.download =
            `SkyCast-${(currentCity?.name || "Weather").replace(/[^a-z0-9]/gi, "-")}.png`;

        link.href = canvas.toDataURL("image/png");

        link.click();

        setStatus("Weather card downloaded.", "success");

    } catch (error) {
        console.error("Download error:", error);

        setStatus("Unable to download weather card.", "error");

    } finally {
        if (button) {
            button.disabled = false;
            button.textContent = originalText || "Download";
        }
    }
}


// ==========================================
// 26. TEMPERATURE UNIT TOGGLE
// ==========================================

function toggleTemperatureUnit() {
    isFahrenheit = !isFahrenheit;

    if (unitToggle) {
        unitToggle.textContent = isFahrenheit ? "°F" : "°C";
    }

    if (currentWeatherData) {
        renderWeather();
    }
}


// ==========================================
// 27. REFRESH WEATHER
// ==========================================

function refreshWeather() {
    if (!currentCoordinates || !currentCity) {
        setStatus("Search for a city first.", "error");
        return;
    }

    loadWeatherByCoordinates(
        currentCoordinates.latitude,
        currentCoordinates.longitude,
        currentCity
    );
}


// ==========================================
// 28. EVENT LISTENERS
// ==========================================

// City Search
if (form) {
    form.addEventListener("submit", event => {
        event.preventDefault();

        loadWeather(cityInput?.value.trim());
    });
}

// Current Location
if (locationBtn) {
    locationBtn.addEventListener("click", getCurrentLocation);
}

// Refresh
if (refreshBtn) {
    refreshBtn.addEventListener("click", refreshWeather);
}
// Celsius / Fahrenheit
if (unitToggle) {
    unitToggle.addEventListener("click", toggleTemperatureUnit);
}

// City Comparison
const compareBtn = $("compareBtn");

if (compareBtn) {
    compareBtn.addEventListener("click", compareCityWeather);
}

// Clear History
const clearHistoryBtn = $("clearHistory");

if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener("click", clearSearchHistory);
}

// Download Weather Card
const downloadButton = $("downloadCard");

if (downloadButton) {
    downloadButton.addEventListener("click", downloadWeatherCard);
}


// ==========================================
// 29. INITIALIZE SKYCAST
// ==========================================

function initializeSkyCast() {
    renderHistory();

    if (unitToggle) {
        unitToggle.textContent = "°C";
    }

    if (weatherContent) {
        weatherContent.hidden = true;
    }

    setStatus("Search for a city to see live weather.", "info");
}

initializeSkyCast();
/* =================================
   SKYCAST - INTERACTIVE WEATHER MAP
================================= */

(() => {
  const mapElement = document.getElementById("weatherMap");
  const mapStatus = document.getElementById("mapStatus");
  const weatherContent = document.getElementById("weatherContent");
  const mapTabs = document.querySelectorAll(".map-tab");
  const placeName = document.getElementById("placeName");

  if (!mapElement || !weatherContent || !window.L) return;
let weatherMap = null;
let cityMarker = null;
let rainLayer = null;

const WEATHER_WORKER_URL =
  "https://helloworld.sindhuram9876.workers.dev";

let cloudsLayer = null;
let temperatureLayer = null;

function updateMapStatus(message) {
  if (mapStatus) mapStatus.textContent = message;
}
  async function moveMapToCity() {
    const city = placeName?.textContent.trim();

    if (!city || city === "--" || !weatherMap) return;

    try {
      const response = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`
      );

      if (!response.ok) throw new Error("Location unavailable");

      const data = await response.json();

      if (!data.results?.length) {
        updateMapStatus("City location could not be found.");
        return;
      }

      const location = data.results[0];
      const position = [location.latitude, location.longitude];

      weatherMap.setView(position, 6);

      if (cityMarker) {
        cityMarker.setLatLng(position);
      } else {
        cityMarker = L.marker(position).addTo(weatherMap);
      }

      cityMarker.bindPopup(
        `<strong>${location.name}</strong><br>${location.country || ""}`
      );

      updateMapStatus(`Map showing ${location.name}, ${location.country || ""}`);

    } catch (error) {
      updateMapStatus("Unable to load city location. Please try again.");
    }
  }
async function loadRainRadar() {
    removeWeatherOverlay();

    updateMapStatus("Loading rain radar...");
    try {
      const response = await fetch(
        "https://api.rainviewer.com/public/weather-maps.json"
      );

      if (!response.ok) throw new Error("Radar unavailable");

      const data = await response.json();
      const frames = data.radar?.past || [];

      if (!frames.length) {
        updateMapStatus("Rain radar data is currently unavailable.");
        return;
      }

      const latestFrame = frames[frames.length - 1];

      if (rainLayer) {
        weatherMap.removeLayer(rainLayer);
      }

      const tileUrl =
        `${data.host}${latestFrame.path}/256/{z}/{x}/{y}/2/1_1.png`;

      rainLayer = L.tileLayer(tileUrl, {
        opacity: 0.7,
        maxZoom: 7,
        attribution:
          'Weather radar © <a href="https://www.rainviewer.com/" target="_blank">RainViewer</a>'
      });

      rainLayer.addTo(weatherMap);

      updateMapStatus("Rain radar loaded. Showing the latest available radar frame.");

    } catch (error) {
      updateMapStatus("Rain radar could not load. Please try again later.");
    }
  }

  // Remove previously selected weather overlay
function removeWeatherOverlay() {
  [rainLayer, cloudsLayer, temperatureLayer].forEach(layer => {
    if (layer && weatherMap.hasLayer(layer)) {
      weatherMap.removeLayer(layer);
    }
  });
}

// Load Clouds or Temperature layer
function loadOpenWeatherLayer(layerName) {
  if (!weatherMap) return;

  removeWeatherOverlay();

  updateMapStatus(`Loading ${layerName} map...`);

  const newLayer = L.tileLayer(
    `${WEATHER_WORKER_URL}/map/${layerName}/{z}/{x}/{y}.png`,
    {opacity: 0.65,
maxNativeZoom: 10,
maxZoom: 19,
attribution: "Weather data © OpenWeather" }
  );

  newLayer.on("load", () => {
    updateMapStatus(`${layerName} map loaded successfully.`);
  });

  newLayer.on("tileerror", () => {
    updateMapStatus(
      `${layerName} map unavailable. Check API access and Worker settings.`
    );
  });

  if (layerName === "clouds_new") {
    cloudsLayer = newLayer;
  } else {
    temperatureLayer = newLayer;
  }

  newLayer.addTo(weatherMap);
}


  function initializeWeatherMap() {
    if (weatherMap) {
      setTimeout(() => weatherMap.invalidateSize(), 150);
      return;
    }

    weatherMap = L.map("weatherMap").setView([20, 0], 2);
    L.tileLayer(
  "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  {
    maxZoom: 19,
    className: "dark-map-tiles",
    attribution: "&copy; OpenStreetMap contributors"
  }
).addTo(weatherMap);


    setTimeout(() => {
      weatherMap.invalidateSize();
      moveMapToCity();
      loadRainRadar();
    }, 200);
  }
mapTabs.forEach(tab => {
  tab.addEventListener("click", () => {

    mapTabs.forEach(item => item.classList.remove("active"));
    tab.classList.add("active");

    const layer = tab.dataset.layer;
    const temperatureLegend = document.getElementById("temperatureLegend");

if (temperatureLegend) {
  temperatureLegend.style.setProperty(
    "display",
    layer === "temperature" ? "flex" : "none",
    "important"
  );
}
    if (layer === "precipitation") {
      removeWeatherOverlay();
      loadRainRadar();

    } else if (layer === "clouds") {
      loadOpenWeatherLayer("clouds_new");

    } else if (layer === "temperature") {
      loadOpenWeatherLayer("temp_new");
    }

  });
});

  const mapObserver = new MutationObserver(() => {
    if (!weatherContent.hidden) {
      initializeWeatherMap();
    }
  });

  mapObserver.observe(weatherContent, {
    attributes: true,
    attributeFilter: ["hidden"]
  });

  if (!weatherContent.hidden) {
    initializeWeatherMap();
  }

  if (placeName) {
    const cityObserver = new MutationObserver(() => {
      if (weatherMap && !weatherContent.hidden) {
        moveMapToCity();
      }
    });

    cityObserver.observe(placeName, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }
})();
// MAP DARK / LIGHT MODE
const mapDarkBtn = document.getElementById("mapDarkBtn");
const mapLightBtn = document.getElementById("mapLightBtn");
const weatherMapElement = document.getElementById("weatherMap");

mapDarkBtn.addEventListener("click", () => {
  weatherMapElement.classList.remove("map-light-mode");

  mapDarkBtn.classList.add("active");
  mapLightBtn.classList.remove("active");
});

mapLightBtn.addEventListener("click", () => {
  weatherMapElement.classList.add("map-light-mode");

  mapLightBtn.classList.add("active");
  mapDarkBtn.classList.remove("active");
});
// WELCOME SECTION VISIBILITY
const welcomeSection = document.getElementById("welcomeSection");

if (welcomeSection && weatherContent) {
  function updateWelcomeVisibility() {
    welcomeSection.hidden = !weatherContent.hidden;
  }

  updateWelcomeVisibility();

  const welcomeObserver = new MutationObserver(updateWelcomeVisibility);

  welcomeObserver.observe(weatherContent, {
    attributes: true,
    attributeFilter: ["hidden"]
  });
}