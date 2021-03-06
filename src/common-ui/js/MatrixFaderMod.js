/*
 alsa-gateway -- provide a REST/HTTP interface to ALSA-Mixer

 Copyright (C) 2015, Fulup Ar Foll

 This program is free software; you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation; either version 2 of the License, or
 (at your option) any later version.

 This program is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this program; if not, write to the Free Software
 Foundation, Inc., 675 Mass Ave, Cambridge, MA 02139, USA.

 References:


 $Id: $
 */


'use strict';

var newModule = angular.module('ajm-matrix-fader', []);

newModule.directive('matrixFader', ["$log", '$timeout', 'CtrlByNumid', function($log, $timeout, CtrlByNumid) {

    function link (scope, element, attrs, model) {

        scope.prefad = [];

        // call when internal model value changes
        scope.initWidget = function(initvalues) {

            if (!initvalues) return; // make sure we have some data to work with
            // $log.log ("matrixFader initvalues=", initvalues)

            // we use left mix as reference and compute right mix from balance level
            var refMix =  initvalues[0];
            scope.range  = (refMix[0].ctrl.notMore - refMix[0].ctrl.notLess);

            // check if mixes are groupe in stereo
            if (refMix[0].length  == 2) scope.stereo = true;

            // attach model to actif sliders and keep a local copy as MixerModel will be erase
            scope.MixerModel  = initvalues;

            // scan model value to extract useful information for UI
            scope.ctrlById= [];
            scope.sliderById= [];
            scope.syncMix= [];

            // do we have two output
            var stereoIn  = (initvalues.length === 2);
            var stereoOut = (initvalues[0].length === 2);

            for (var idx=0; idx < initvalues.length; idx ++) {
                if (stereoOut) scope.syncMix [idx] = false;  // by default stereo mix are synchronized

                var playback = initvalues [idx];
                for (var jdx=0; jdx < playback.length; jdx ++) {
                    var current =  playback [jdx];
                    scope.ctrlById [current.channel.numid] = current.ctrl;
                }
            }
        };

        // this method sync/unsync stereo output channel [ex: Mix A/B]
        // sync sliders are disable to remove handle
        // unsync sliders are actif but with a "not-sync" class in order CSS to reduce handle size
        scope.StereoMix = function (event, index) {

            var button = angular.element(event.target);
            if (scope.syncMix [index]) {
               scope.syncMix  [index] = false;
               button.removeClass ("pfl-button-actif")

               // loop on associative array to check which slide should be unsync 
               Object.keys(scope.sliderById).forEach(function(key, idx) {
                   var handle =  scope.sliderById[key].getCbHandle();
                   var slider =  scope.sliderById[key];

                   if (handle.idxin === index) {
                       slider.updateClass("not-sync", true);
                       if (handle.idxout !== 0)   slider.setDisable(false);
                   }
               }, scope.sliderById);
                
            } else {
               scope.syncMix  [index] = true;
               var value=0;
               // loop on associative array to check which slide should be unsync
               Object.keys(scope.sliderById).forEach(function(key, idx) {
                  var handle =  scope.sliderById[key].getCbHandle();
                  var slider =  scope.sliderById[key];

                  if (handle.idxin === index) {
                      scope.sliderById[key].updateClass ("not-sync", false);
                      if (handle.idxout == 0) {
                          value = slider.getValue();
                      } else {
                          slider.setDisable(true);
                          slider.setValue (value);
                      }
                  }
               }, scope.sliderById);
               button.addClass ("pfl-button-actif")
            }
        };
            
        scope.SliderInit = function(slider) {

            var handle =  slider.getCbHandle();
            // buid a list and an associative array of controls
            scope.sliderById [handle.numid] = slider;

            // register Numid Control in central register for session upload
            CtrlByNumid.register (handle.numid, slider);
        };

        // formatter CB are call when a slide move, then should return value presented in handle
        scope.FaderSliderCB  = function (value, slider) {
            var targets=[]; // numid concerned by this action

            // ignore initial slider settings
            if (slider == undefined) return (value);


            // if capture are in sync let's move all channels together
            if (scope.prefad.PFLM) {
                // loop on associative array to check which slider should be unsync
                Object.keys(scope.sliderById).forEach(function(key, idx) {
                    var handle =  scope.sliderById[key].getCbHandle();
                    var slider =  scope.sliderById[key];
                    slider.setValue (value);
                    targets.push (handle.numid);
                }, scope.sliderById);
            } else {

                // extract cbHandle from slider object
                var handle = slider.getCbHandle();
                targets.push(handle.numid); // main channel is always part of tageted control

                //$log.log("FaderSliderCB numid=", handle.numid, " value=", value, 'handle=', handle);

                // if playback mix are in sync move both playback channels
                if (scope.syncMix [handle.idxin]) {
                    var next = scope.sliderById[handle.numid + 1]; // output payback channels from mix A/B have continuous numid
                    next.setValue(value);
                    targets.push(handle.numid + 1);
                }
            }

            // send value to every concerned channel control numid
            // console.log ("numids=%j value=%d", targets, value)
            // provide some non linear curve for volume sliders [would need help to improved]
            var normalized = parseInt (Math.sqrt (value/scope.range)*scope.range);
            // console.log ("normalized=%d value=%d range=%d", normalized, value, scope.range);
            if (!scope.ismuted) scope.callback (targets, normalized);

            // return value displays within handle
            return (normalized);
        };


        scope.ToggleMute = function (channel, muted) {

            if (muted) {
                scope.ismuted = true;
                var targets = []; // update all channel NumId in one call
                // Get Numids Attach to this slider and mute them
                Object.keys(scope.sliderById).forEach(function (key, idx) {
                    var handle = scope.sliderById[key].getCbHandle();
                    if (channel == handle.idxin) targets.push(handle.numid);
                }, scope.sliderById);

                // Mute channel
                scope.callback (targets, 0);
            } else {
                scope.ismuted = false;

                // Restore previous values sending back original values to sndcard
                Object.keys(scope.sliderById).forEach(function (key, idx) {
                    var handle = scope.sliderById[key].getCbHandle();
                    if (channel == handle.idxin) {
                        var slider = scope.sliderById[key];
                        var value = slider.getValue(value);
                        scope.callback([handle.numid], value);
                    }
                }, scope.sliderById);
            }
        };


        // Toogle Pre-Fader button and ajust class for CSS rendering
        scope.PreFader = function (event, action) {

           var button = angular.element(event.target);

           if (scope.prefad [action]) {
               scope.prefad [action] = false;
               button.removeClass ("pfl-button-actif")

               if (action == 'MUTL') scope.ToggleMute (0, false);
               if (action == 'MUTR') scope.ToggleMute (1, false);
           } else {
               scope.prefad [action] = true;
               button.addClass ("pfl-button-actif")
               if (action == 'MUTL') scope.ToggleMute (0, true);
               if (action == 'MUTR') scope.ToggleMute (1, true);
           }
        };


        // initialize widget
        scope.inputid  = attrs.id    || "analog-in-" + parseInt (Math.random() * 1000);
        scope.name     = attrs.name  || "NoName";
        scope.label    = attrs.label || "NoLabel";
        scope.switchid = attrs.id | "switch-" + parseInt (Math.random() * 1000);
        scope.$watch ('initvalues', function () { 	// init Values may arrive late
            if (scope.initvalues) scope.initWidget(scope.initvalues);
        });

    }

    return {
    templateUrl: "partials/matrix-fader.html",
    scope: {
        callback: '=',
        initvalues : '='
    },
    restrict: 'E',
    link: link
    };
}]);

console.log ("Matrix Fader loaded");

