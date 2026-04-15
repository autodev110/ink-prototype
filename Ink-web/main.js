(function (global) {
    "use strict";

    var STATUS_LINE_RE = /^(HEALTH:|AMMO:|ACCESS CARD(?:S)?:)/i;
    var ENDING_LINE_RE = /^ENDING:\s*/i;
    var MOTION_QUERY = global.matchMedia
        ? global.matchMedia("(prefers-reduced-motion: no-preference)")
        : null;

    var dom = {};
    var state = {
        story: null,
        isAdvancing: false
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap);
    } else {
        bootstrap();
    }

    function bootstrap() {
        cacheDom();

        if (!global.inkjs || !global.storyContent) {
            renderFatal("Ink runtime or compiled story data could not be loaded.");
            return;
        }

        bindControls();
        restartStory({ scroll: false });
    }

    function cacheDom() {
        dom.root = document.querySelector("[data-app]");
        dom.appHeader = document.querySelector(".app-header");
        dom.sessionLabel = document.getElementById("sessionLabel");
        dom.storyCredit = document.getElementById("storyCredit");
        dom.sceneHeading = document.getElementById("sceneHeading");
        dom.scene = document.getElementById("scene");
        dom.choicesPanel = document.getElementById("choicesPanel");
        dom.choicesHeading = document.getElementById("choicesHeading");
        dom.choices = document.getElementById("choices");
        dom.restartButton = document.getElementById("restartButton");
        dom.endingPanel = document.getElementById("endingPanel");
        dom.endingTitle = document.getElementById("endingTitle");
        dom.endingSummary = document.getElementById("endingSummary");
        dom.endingRestartButton = document.getElementById("endingRestartButton");
        dom.playerCard = document.getElementById("playerCard");
        dom.healthCard = document.getElementById("healthCard");
        dom.ammoCard = document.getElementById("ammoCard");
        dom.cardsCard = document.getElementById("cardsCard");
        dom.restartCard = document.getElementById("restartCard");
        dom.statusPlayer = document.getElementById("statusPlayer");
        dom.statusHealth = document.getElementById("statusHealth");
        dom.statusAmmo = document.getElementById("statusAmmo");
        dom.statusCards = document.getElementById("statusCards");
    }

    function bindControls() {
        if (dom.restartButton) {
            dom.restartButton.addEventListener("click", function () {
                restartStory();
            });
        }

        if (dom.endingRestartButton) {
            dom.endingRestartButton.addEventListener("click", function () {
                restartStory();
            });
        }
    }

    function restartStory(options) {
        options = options || {};

        try {
            state.story = new global.inkjs.Story(global.storyContent);
        } catch (error) {
            console.error(error);
            renderFatal("The compiled Ink story could not be started.");
            return;
        }

        state.isAdvancing = false;
        setSceneBackground(null);
        applyGlobalTags();
        renderTurn({ scroll: options.scroll !== false });
    }

    function applyGlobalTags() {
        var author = "";
        var tags = Array.isArray(state.story.globalTags) ? state.story.globalTags : [];

        tags.forEach(function (tag) {
            var splitTag = splitPropertyTag(tag);
            if (!splitTag) {
                return;
            }

            if (splitTag.property.toLowerCase() === "author") {
                author = splitTag.val;
            }
        });

        if (author) {
            dom.storyCredit.hidden = false;
            dom.storyCredit.textContent = "Author: " + author;
        } else {
            dom.storyCredit.hidden = true;
            dom.storyCredit.textContent = "";
        }
    }

    function renderTurn(options) {
        options = options || {};

        if (!state.story) {
            return;
        }

        try {
            var packet = collectScenePacket();
            if (packet.restarted) {
                return;
            }

            state.isAdvancing = false;
            renderScene(packet);
            renderChoices(packet);
            updateStatus();
            updateChrome(packet);

            if (options.scroll !== false) {
                scrollToTop();
            }
        } catch (error) {
            console.error(error);
            state.isAdvancing = false;
            renderFatal("The story UI hit a rendering error.");
        }
    }

    function collectScenePacket() {
        var items = [];
        var endingTitle = "";
        var restartRequested = false;

        while (state.story.canContinue) {
            var paragraphText = state.story.Continue();
            var tagOutcome = processTags(state.story.currentTags || [], items);

            if (tagOutcome.restartRequested) {
                restartRequested = true;
                break;
            }

            var htmlText = trimStoryText(paragraphText);
            if (!htmlText) {
                continue;
            }

            var plainText = stripHtml(htmlText);
            if (!plainText) {
                continue;
            }

            if (STATUS_LINE_RE.test(plainText)) {
                continue;
            }

            if (ENDING_LINE_RE.test(plainText)) {
                endingTitle = plainText.replace(ENDING_LINE_RE, "").trim();
                continue;
            }

            items.push({
                type: "paragraph",
                html: htmlText,
                classes: tagOutcome.classes
            });
        }

        if (restartRequested) {
            restartStory({ scroll: false });
            return { restarted: true };
        }

        return {
            items: items,
            choices: state.story.currentChoices.slice(),
            endingTitle: endingTitle,
            isEnding: !state.story.canContinue && state.story.currentChoices.length === 0
        };
    }

    function processTags(tags, items) {
        var classes = [];
        var restartRequested = false;

        tags.forEach(function (tag) {
            var splitTag = splitPropertyTag(tag);
            var property = splitTag ? splitTag.property.toUpperCase() : "";

            if (splitTag && property === "CLASS") {
                classes.push(splitTag.val);
                return;
            }

            if (splitTag && property === "IMAGE") {
                items.push({
                    type: "image",
                    src: splitTag.val
                });
                return;
            }

            if (splitTag && property === "BACKGROUND") {
                setSceneBackground(splitTag.val);
                return;
            }

            if (splitTag && property === "LINK") {
                global.location.href = splitTag.val;
                return;
            }

            if (splitTag && property === "LINKOPEN") {
                global.open(splitTag.val, "_blank", "noopener,noreferrer");
                return;
            }

            if (String(tag).toUpperCase() === "CLEAR") {
                items.length = 0;
                return;
            }

            if (String(tag).toUpperCase() === "RESTART") {
                restartRequested = true;
            }
        });

        return {
            classes: classes,
            restartRequested: restartRequested
        };
    }

    function renderScene(packet) {
        var fragment = document.createDocumentFragment();
        var leadAssigned = false;

        packet.items.forEach(function (item) {
            if (item.type === "image") {
                var image = document.createElement("img");
                image.className = "story-image";
                image.src = item.src;
                image.alt = "";
                fragment.appendChild(image);
                return;
            }

            var paragraph = document.createElement("p");
            paragraph.className = "story-line";
            paragraph.innerHTML = item.html;

            if (!leadAssigned) {
                paragraph.classList.add("story-line--lead");
                leadAssigned = true;
            }

            item.classes.forEach(function (customClass) {
                paragraph.classList.add(customClass);
            });

            fragment.appendChild(paragraph);
        });

        if (!packet.items.length) {
            var placeholder = document.createElement("p");
            placeholder.className = "story-line story-line--lead";
            placeholder.textContent = "...";
            fragment.appendChild(placeholder);
        }

        dom.scene.replaceChildren(fragment);
    }

    function renderChoices(packet) {
        dom.choices.replaceChildren();

        if (packet.isEnding) {
            dom.choicesPanel.hidden = true;
            return;
        }

        dom.choicesPanel.hidden = false;

        var fragment = document.createDocumentFragment();
        packet.choices.forEach(function (choice) {
            var choiceState = getChoiceState(choice);
            var button = document.createElement("button");
            var marker = document.createElement("span");
            var label = document.createElement("span");

            button.type = "button";
            button.className = "choice-button";
            button.disabled = state.isAdvancing || !choiceState.clickable;

            marker.className = "choice-marker";
            marker.setAttribute("aria-hidden", "true");
            marker.textContent = choiceState.clickable ? ">" : "x";

            label.className = "choice-label";
            label.innerHTML = choice.text;

            button.appendChild(marker);
            button.appendChild(label);

            choiceState.classes.forEach(function (customClass) {
                button.classList.add(customClass);
            });

            if (choiceState.clickable) {
                button.addEventListener("click", function () {
                    advanceChoice(choice.index);
                });
            }

            fragment.appendChild(button);
        });

        dom.choices.appendChild(fragment);
    }

    function getChoiceState(choice) {
        var classes = [];
        var clickable = true;

        (choice.tags || []).forEach(function (tag) {
            var splitTag = splitPropertyTag(tag);
            var property = splitTag ? splitTag.property.toUpperCase() : "";

            if (splitTag && property === "CLASS") {
                classes.push(splitTag.val);
                return;
            }

            if (String(tag).toUpperCase() === "UNCLICKABLE") {
                clickable = false;
            }
        });

        return {
            classes: classes,
            clickable: clickable
        };
    }

    function advanceChoice(index) {
        if (state.isAdvancing || !state.story) {
            return;
        }

        state.isAdvancing = true;
        disableChoices();

        try {
            state.story.ChooseChoiceIndex(index);
            renderTurn({ scroll: true });
        } catch (error) {
            console.error(error);
            state.isAdvancing = false;
            renderFatal("The selected choice could not be processed.");
        }
    }

    function disableChoices() {
        dom.choices.querySelectorAll("button").forEach(function (button) {
            button.disabled = true;
        });
    }

    function updateStatus() {
        var playerId = readVar("player_id", "");
        var health = clampNumber(readVar("health", 0), 0, 3);
        var bullets = clampNumber(readVar("bullets", 0), 0, 5);
        var cards = [];

        if (readVar("keycard_a", false)) {
            cards.push("A");
        }

        if (readVar("keycard_b", false)) {
            cards.push("B");
        }

        dom.statusPlayer.textContent = playerId || "Pending";
        dom.statusHealth.textContent = formatRatio(health, 3);
        dom.statusAmmo.textContent = formatRatio(bullets, 5);

        dom.healthCard.classList.toggle("is-alert", health <= 1);
        dom.ammoCard.classList.toggle("is-alert", bullets <= 1);
        dom.playerCard.classList.toggle("is-alert", !playerId);

        dom.cardsCard.hidden = cards.length === 0;
        dom.statusCards.replaceChildren();

        cards.forEach(function (cardId) {
            var card = document.createElement("li");
            card.className = "card-pill";
            card.textContent = "Card " + cardId;
            dom.statusCards.appendChild(card);
        });
    }

    function updateChrome(packet) {
        var playerId = readVar("player_id", "");
        var sessionText = "";
        var sceneHeading = "";
        var choiceHeading = "";
        var titleText = "Patient 0000";

        if (!playerId) {
            sessionText = "Select a subject to begin.";
            sceneHeading = "Intake Selection";
            choiceHeading = "Select Subject";
        } else if (packet.isEnding) {
            sessionText = "Subject " + playerId + " // outcome logged.";
            sceneHeading = "Final Record";
            choiceHeading = "No Further Actions";
            titleText = packet.endingTitle
                ? packet.endingTitle + " • Patient 0000"
                : "Patient 0000";
        } else {
            sessionText = "Subject " + playerId + " // containment in progress.";
            sceneHeading = "Current Scene";
            choiceHeading = "Available Actions";
            titleText = "Subject " + playerId + " • Patient 0000";
        }

        dom.sessionLabel.textContent = sessionText;
        dom.sceneHeading.textContent = sceneHeading;
        dom.choicesHeading.textContent = choiceHeading;
        document.title = titleText;

        var hasStarted = Boolean(playerId);
        document.body.classList.toggle("has-started", hasStarted);
        if (dom.appHeader) {
            dom.appHeader.hidden = false;
            dom.appHeader.style.display = hasStarted ? "none" : "";
        }
        if (dom.restartCard) {
            dom.restartCard.hidden = !hasStarted;
        }

        document.body.classList.toggle("is-ending", packet.isEnding);
        dom.endingPanel.hidden = !packet.isEnding;

        if (packet.isEnding) {
            dom.endingTitle.textContent = packet.endingTitle || "Run Complete";
            dom.endingSummary.textContent = playerId
                ? "Outcome recorded for Subject " + playerId + ". Restart to explore another route."
                : "This route has concluded. Restart to begin again.";
        } else {
            dom.endingTitle.textContent = "Run Complete";
            dom.endingSummary.textContent = "This route has concluded. Restart to follow another branch.";
        }
    }

    function renderFatal(message) {
        document.body.classList.remove("is-ending");
        dom.scene.replaceChildren();
        dom.choices.replaceChildren();
        dom.choicesPanel.hidden = true;
        dom.endingPanel.hidden = true;
        dom.cardsCard.hidden = true;
        setSceneBackground(null);

        var paragraph = document.createElement("p");
        paragraph.className = "story-line story-line--lead";
        paragraph.textContent = message;
        dom.scene.appendChild(paragraph);

        dom.sceneHeading.textContent = "System Error";
        dom.sessionLabel.textContent = "The story interface could not continue.";
        document.title = "Patient 0000";
    }

    function readVar(name, fallback) {
        if (!state.story) {
            return fallback;
        }

        try {
            var value = state.story.variablesState.$(name);
            return value == null ? fallback : value;
        } catch (error) {
            return fallback;
        }
    }

    function setSceneBackground(source) {
        var value = source
            ? 'url("' + source.replace(/"/g, '\\"') + '")'
            : 'url("./ink_background.png")';
        document.documentElement.style.setProperty("--scene-background-image", value);
    }

    function formatRatio(value, maxValue) {
        return String(value) + " / " + String(maxValue);
    }

    function clampNumber(value, min, max) {
        var number = Number(value);
        if (!Number.isFinite(number)) {
            return min;
        }

        return Math.max(min, Math.min(max, number));
    }

    function trimStoryText(text) {
        return String(text || "").replace(/^\s+|\s+$/g, "");
    }

    function stripHtml(text) {
        return String(text || "")
            .replace(/<[^>]*>/g, "")
            .replace(/&nbsp;/gi, " ")
            .trim();
    }

    function splitPropertyTag(tag) {
        var propertySplitIndex = String(tag).indexOf(":");
        if (propertySplitIndex === -1) {
            return null;
        }

        return {
            property: String(tag).slice(0, propertySplitIndex).trim(),
            val: String(tag).slice(propertySplitIndex + 1).trim()
        };
    }

    function scrollToTop() {
        var behavior = MOTION_QUERY && MOTION_QUERY.matches ? "smooth" : "auto";

        global.scrollTo({
            top: 0,
            behavior: behavior
        });
    }
})(window);
