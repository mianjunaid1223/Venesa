/**
 * ═══════════════════════════════════════════════════════════════
 *  MODULE: Main Window
 *  Spotlight-style search/command bar.
 * ═══════════════════════════════════════════════════════════════
 */

const { BrowserWindow, screen, app } = require("electron");
const path = require("path");

const WINDOW_WIDTH = 680;
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 500;
const ANIMATION_DURATION = 150;
const ANIMATION_STEPS = 12;

let mainWindow = null;
let animationInProgress = false;
let animationTimeout = null;

app.on("before-quit", () => {
  app.isQuitting = true;
});

const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);

const cancelAnimation = () => {
  if (animationTimeout) {
    clearTimeout(animationTimeout);
    animationTimeout = null;
  }
  animationInProgress = false;
};

function createWindow(startHidden) {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: MIN_HEIGHT,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "../preload/main.preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "../../renderer/main.window.html"));
  mainWindow.center();

  mainWindow.once("ready-to-show", () => {
    if (!startHidden) {
      mainWindow.show();
    }
  });

  mainWindow.on("blur", () => {
    if (mainWindow.isDestroyed()) return;
    cancelAnimation();
    const bounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: bounds.x,
      y: bounds.y,
      width: WINDOW_WIDTH,
      height: MIN_HEIGHT,
    });
    mainWindow.hide();
  });

  mainWindow.on("close", (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  return mainWindow;
}

function getWindow() {
  return mainWindow;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const cursorPoint = screen.getCursorScreenPoint();
  const currentDisplay = screen.getDisplayNearestPoint(cursorPoint);
  const { x, y, width, height } = currentDisplay.workArea;
  const windowX = Math.round(x + (width - WINDOW_WIDTH) / 2);
  const windowY = Math.round(y + height * 0.2);

  mainWindow.setBounds({
    x: windowX,
    y: windowY,
    width: WINDOW_WIDTH,
    height: MIN_HEIGHT,
  });

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("focus-input");
}

function animateWindowHeight(fromHeight, toHeight) {
  if (fromHeight === toHeight) return;
  cancelAnimation();

  if (!mainWindow || mainWindow.isDestroyed()) return;

  const bounds = mainWindow.getBounds();
  const heightDiff = toHeight - fromHeight;
  const stepDuration = ANIMATION_DURATION / ANIMATION_STEPS;
  let currentStep = 0;

  const animate = () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      cancelAnimation();
      return;
    }

    currentStep++;
    const progress = currentStep / ANIMATION_STEPS;
    const easedProgress = easeOutCubic(progress);
    const newHeight = Math.round(fromHeight + heightDiff * easedProgress);
    const currentBounds = mainWindow.getBounds();

    mainWindow.setBounds({
      x: currentBounds.x,
      y: currentBounds.y,
      width: currentBounds.width,
      height: newHeight,
    });

    if (
      currentStep < ANIMATION_STEPS &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      animationTimeout = setTimeout(animate, stepDuration);
    } else {
      animationInProgress = false;
      animationTimeout = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        const finalBounds = mainWindow.getBounds();
        mainWindow.setBounds({
          x: finalBounds.x,
          y: finalBounds.y,
          width: finalBounds.width,
          height: toHeight,
        });
      }
    }
  };

  animationInProgress = true;
  animate();
}

function handleResize(contentHeight) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const newHeight = Math.max(
    MIN_HEIGHT,
    Math.min(Math.round(contentHeight), MAX_HEIGHT),
  );
  const [, currentHeight] = mainWindow.getSize();
  if (currentHeight !== newHeight) {
    animateWindowHeight(currentHeight, newHeight);
  }
}

module.exports = {
  createWindow,
  getWindow,
  showWindow,
  handleResize,
  cancelAnimation,
  WINDOW_WIDTH,
  MIN_HEIGHT,
  MAX_HEIGHT,
};
