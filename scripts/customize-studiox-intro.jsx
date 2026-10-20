/*
 * Run inside After Effects: File > Scripts > Run Script File.
 * Requires the original FedyaL template to be open, with its media resolved.
 * Based on https://www.youtube.com/watch?v=SHJl7MdEjqQ (00:45-01:32).
 * Prepared for AE 2019's ExtendScript API; not yet executed in After Effects.
 * Edits are one undo group. Does not save, overwrite, or render the project.
 */
(function () {
  var title = 'StudioX';
  var red = [232 / 255, 39 / 255, 63 / 255]; // #E8273F
  var white = [242 / 255, 243 / 255, 245 / 255]; // #F2F3F5
  var names = ['text RENAME', 'text2 RENAME', 'text3 RENAME'];
  var animatorName = 'StudioX - red X';
  var layers = [];
  var problems = [];
  var warnings = [];
  var i;
  var j;
  var k;

  function normalized(name) {
    return name.toLowerCase().replace(/\s+/g, '');
  }

  function textProperty(layer) {
    return layer.property('ADBE Text Properties').property('ADBE Text Document');
  }

  if (!app.project || app.project.numItems === 0) {
    alert('Open the original FedyaL After Effects template first.');
    return;
  }

  // Inspect every required composition before changing anything. Exact names
  // come from the tutorial; do not replace unrelated text in the project.
  for (i = 0; i < names.length; i++) {
    var matches = [];
    for (j = 1; j <= app.project.numItems; j++) {
      var item = app.project.item(j);
      if (item instanceof CompItem && normalized(item.name) === normalized(names[i])) {
        matches.push(item);
      }
    }
    if (matches.length !== 1) {
      problems.push(names[i] + ': expected one composition, found ' + matches.length);
      continue;
    }

    var comp = matches[0];
    var count = 0;
    for (k = 1; k <= comp.numLayers; k++) {
      var layer = comp.layer(k);
      if (layer.matchName !== 'ADBE Text Layer') {
        continue;
      }
      count++;
      var source = textProperty(layer);
      // Unexpected source animation needs inspection of the real template.
      if (source.expressionEnabled || source.numKeys > 0) {
        problems.push(comp.name + ' / ' + layer.name + ': animated or expression-driven Source Text');
      }
      if (source.value.allCaps || source.value.smallCaps) {
        problems.push(comp.name + ' / ' + layer.name + ': disable All Caps / Small Caps to display StudioX');
      }
      layers.push(layer);
    }
    if (count === 0) {
      problems.push(comp.name + ': no direct editable text layers');
    }
  }

  if (problems.length > 0) {
    alert('No changes made. Inspect these template differences:\n\n' + problems.join('\n'));
    return;
  }

  var failed = false;
  app.beginUndoGroup('StudioX intro title and red X');
  try {
    for (i = 0; i < layers.length; i++) {
      var target = layers[i];
      var wasLocked = target.locked;
      target.locked = false;
      try {
        var text = textProperty(target);
        var document = text.value;
        // Retain the template's font, size, alignment and tracking.
        document.text = title;
        document.applyFill = true;
        document.fillColor = white;
        text.setValue(document);

        var animators = target.property('ADBE Text Properties').property('ADBE Text Animators');
        // Rerunning replaces only our color animator.
        for (j = animators.numProperties; j >= 1; j--) {
          if (animators.property(j).name === animatorName) {
            animators.property(j).remove();
          }
        }
        var animator = animators.addProperty('ADBE Text Animator');
        animator.name = animatorName;
        animator.property('ADBE Text Animator Properties').addProperty('ADBE Text Fill Color').setValue(red);
        var selectors = animator.property('ADBE Text Selectors');
        var range = selectors.addProperty('ADBE Text Selector');
        range.property('ADBE Text Percent Start').setValue(100 * (title.length - 1) / title.length);
        range.property('ADBE Text Percent End').setValue(100);
        range.property('ADBE Text Percent Offset').setValue(0);
        range.property('ADBE Text Range Advanced').property('ADBE Text Selector Smoothness').setValue(0);

        warnings.push(target.containingComp.name + ' / ' + target.name);
      } finally {
        target.locked = wasLocked;
      }
    }
  } catch (error) {
    failed = true;
    alert('Customization stopped: ' + error.toString() + '\n\nUse Edit > Undo once to revert this run. Nothing was saved.');
  } finally {
    app.endUndoGroup();
  }

  if (!failed) {
    alert('Updated ' + layers.length + ' text layers to StudioX with a red X.\n\n' +
      warnings.join('\n') + '\n\nPreview the final composition: check mirrored text, centering, crack masks, and whether downstream effects remove the red. Save as a new project after reviewing.');
  }
}());
