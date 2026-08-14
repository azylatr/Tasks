/**
 * Retrieves the first non-internal network interface address of the machine, it can be configured to return an IPv4 or IPv6 address
 *
 *
 * @typedef {'IPv4' | 'IPv6'} IP version
 * @param {IPVersion} [mode='IPv4'] - The IP address family to retrieve ('IPv4' or 'IPv6')
 * @returns {string} The IP address found, or the loopback address '127.0.0.1' as a fallback
 */
function address(mode: string = '') {
    const interfaces = require("os").networkInterfaces();  
    const address = Object.values(interfaces)
        .flat()
        .find((iface) => {
            return iface?.family === mode && ! iface?.internal;
        })?.address;

    if (address) return address;

    // Fallback to loopback address if no external address is found
    return mode === 'IPv6' ? '::1' : '127.0.0.1';
};
