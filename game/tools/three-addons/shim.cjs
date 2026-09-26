// Stands in for the 'three' package inside the addon bundle: the addons get
// the THREE that vendor/three.min.js already put on the page.
if (typeof window === 'undefined' || !window.THREE) throw new Error('three-addons.js needs vendor/three.min.js loaded first');
module.exports = window.THREE;
