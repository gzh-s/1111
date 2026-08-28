const nameColor = {
    'mod': '#6f00ff',
    'su': '#6f00ff',
    'pu': '#AD8B00',

};
const badgeBgColor = {
    'mod': '#cf70ab',
    'su': '#6f00ff',
    'pu': '#AD8B00',

};
const badgeTextColor = {
    'mod': '#FFF',
    'su': '#FFF',
    'pu': '#FFF',

};
const style = document.createElement('style');
document.head.appendChild(style);
for (const key in nameColor) {
    const className = `.uname--${key}`;
    const colorValue = nameColor[key];
    style.sheet.insertRule(
        `${className} { color: ${colorValue} !important; font-weight: bold; }`,
        style.sheet.cssRules.length
    );
}
for (const key in badgeBgColor) {
    const className = `.badge--${key}`;
    const colorValue = badgeBgColor[key];
    style.sheet.insertRule(
        `${className} { background-color: ${badgeBgColor[key]} !important; color: ${badgeTextColor} !important }`,
        style.sheet.cssRules.length
    );
}