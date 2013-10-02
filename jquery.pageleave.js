// Create closure.
(function( $ ) {
	var opts = times = start = null;
	// Plugin definition.
	$.fn.pageleave = function( options ) {
		opts = $.extend( {}, $.fn.pageleave.defaultOptions, options );
		times = opts.times;
		start = new Date().getTime();
		init();
	};

	function init() {
		$(opts.container).on('mousemove.pageleave', function(evt) {
			var elapsed = new Date().getTime() - start;
			if ((evt.clientY <= opts.limitY) && (elapsed >= opts.timeTillActive)) {
				if (times > 0) times--;
			    if (typeof opts.callback == 'function') opts.callback.call(this);
			    else triggerEvent();
			}
		});
	}

	function triggerEvent() {
		$(opts.container).trigger('pageleave');
		if (!times) $(opts.container).off('mousemove.pageleave');
		console.log("times: " + times);
	}
})( jQuery );

// Plugin defaults – added as a property on our plugin function.
$.fn.pageleave.defaultOptions = {
	container:  document,
	limitX: screen.width,
	limitY: 15,
	timeTillActive: 5000,
	timeTillTrigger: 0,
	times: 3,
	fireDelay: 0,
	callback: null
};