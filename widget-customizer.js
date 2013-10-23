/*global wp, Backbone, jQuery, WidgetCustomizer_exports, console, alert */
var WidgetCustomizer = (function ($) {
	'use strict';

	var customize = wp.customize;
	var self = {
		update_widget_ajax_action: null,
		update_widget_nonce_value: null,
		update_widget_nonce_post_key: null,
		i18n: {},
		available_widgets: []
	};
	$.extend(self, WidgetCustomizer_exports);

	/**
	 * Set up model
	 */
	var Widget = self.Widget = Backbone.Model.extend({
		id: null,
		temp_id: null,
		classname: null,
		control_tpl: null,
		description: null,
		is_disabled: null,
		is_multi: null,
		multi_number: null,
		name: null,
		id_base: null,
		transport: 'refresh',
		params: []
		// @todo methods for adding and removing instances, and logic if ! is_multi
	});
	var WidgetLibrary = self.WidgetLibrary = Backbone.Collection.extend({
		model: Widget
	});
	self.available_widgets = new WidgetLibrary(self.available_widgets);

	/**
	 * Sidebar Widgets control
	 * Note that 'sidebar_widgets' must match the Sidebar_Widgets_WP_Customize_Control::$type
	 */
	customize.controlConstructor.sidebar_widgets = customize.Control.extend({

		/**
		 * Set up the control
		 */
		ready: function() {
			var control = this;
			control.control_section = control.container.closest( '.control-section' );
			control.section_content = control.container.closest( '.accordion-section-content' );
			control.setupSortable();
			control.setupAddition();
			control.setupDeletion();
			// @link https://github.com/x-team/wp-widget-customizer/issues/3
		},
		
		/**
		 * Update the preview window based on the current widgets, possibly having just be reordered, 
		 * added to or removed from.
		 */
		updatePreview: function(){
			var control = this;
			var widget_container_ids = control.section_content.sortable('toArray');
			var widget_ids = $.map( widget_container_ids, function ( widget_container_id ) {
				return $('#' + widget_container_id).find(':input[name=widget-id]').val();
			});
			control.setting( widget_ids );
		},

		/**
		 * Allow widgets in sidebar to be re-ordered, and for the order to be previewed
		 */
		setupSortable: function () {
			var control = this;

			/**
			 * Update widget order setting when controls are re-ordered
			 */
			control.section_content.sortable({
				items: '> .customize-control-widget_form',
				axis: 'y',
				connectWith: '.accordion-section-content:has(.customize-control-sidebar_widgets)',
				update: function () {
					control.updatePreview();
				}
			});

			/**
			 * Update ordering of widget control forms when the setting is updated
			 */
			control.setting.bind( function( to ) {
				var controls = control.section_content.find('> .customize-control-widget_form');

				// Build up index
				var widget_positions = {};
				$.each( to, function ( i, widget_id ) {
					widget_positions[widget_id] = i;
				});
				controls.each( function () {
					var widget_id = $(this).find('input[name="widget-id"]').val();
					$(this).data('widget-id', widget_id);
				});

				// Sort widget controls to their new positions
				controls.sort(function ( a, b ) {
					var a_widget_id = $(a).data('widget-id');
					var b_widget_id = $(b).data('widget-id');
					if ( widget_positions[a_widget_id] === widget_positions[b_widget_id] ) {
						return 0;
					}
					return widget_positions[a_widget_id] < widget_positions[b_widget_id] ? -1 : 1;
				});

				// Append the controls to put them in the right order
				control.section_content.append( controls );
			});

			/**
			 * Expand other customizer sidebar section when dragging a control widget over it,
			 * allowing the control to be dropped into another section
			 */
			control.control_section.find( '.accordion-section-title').droppable({
				accept: '.customize-control-widget_form',
				over: function ( event, ui ) {
					if ( ! control.control_section.hasClass('open') ) {
						control.control_section.addClass('open');
						control.section_content.toggle(false).slideToggle(150, function () {
							control.section_content.sortable( 'refreshPositions' );
						});
					}
				}
			});
		},

		/**
		 *
		 */
		setupAddition: function () {
			var control = this;
			control.populateAvailableWidgets();
			self.available_widgets.on('change', function () {
				control.populateAvailableWidgets();
			});

			var select = control.container.find('.available-widgets');
			select.on( 'change', function () {
				var widget_id = $(this).val();
				this.selectedIndex = 0; // "Add widget..."
				control.addWidget( widget_id );
			});
		},

		/**
		 * @param {string} widget_id
		 */
		addWidget: function ( widget_id ) {
			var control = this;
			var widget = self.available_widgets.findWhere({id: widget_id});
			if ( ! widget ) {
				throw new Error( 'Widget unexpectedly not found.' );
			}
			var control_html = widget.get('control_tpl');
			var multi_number = widget.get('multi_number');

			if ( widget.get( 'is_multi' ) ) {
				multi_number += 1;
				control_html = control_html.replace(/<[^<>]+>/g, function (m) {
					return m.replace( /__i__|%i%/g, multi_number );
				});
				widget.set( 'multi_number', multi_number );
			}
			else {
				widget.set( 'is_disabled', true );
			}
			var customize_control_type = 'widget_form';

			var customize_control = $('<li></li>');
			customize_control.addClass( 'customize-control' );
			customize_control.addClass( 'customize-control-' + customize_control_type );
			customize_control.append( $(control_html) );
			customize_control.hide();
			widget_id = customize_control.find('[name="widget-id"]' ).val();

			var setting_id = 'widget_' + widget.get('id_base');
			if ( widget.get( 'is_multi' ) ) {
				setting_id += '[' + multi_number + ']';
			}
			customize_control.attr( 'id', 'customize-control-' + setting_id.replace( /\]/g, '' ).replace( /\[/g, '-' ) );

			this.container.after( customize_control );

			wp.customize.create( setting_id, setting_id, {}, {
				transport: widget.get( 'transport' ),
				previewer: control.setting.previewer
			} );

			var Constructor = wp.customize.controlConstructor[customize_control_type];
			var widget_form_control = new Constructor( setting_id, {
				params: {
					settings: {
						'default': setting_id
					},
					sidebar_id: control.sidebar_id,
					widget_id: widget_id,
					type: customize_control_type
				},
				previewer: control.setting.previewer
			} );
			wp.customize.control.add( setting_id, widget_form_control );

			customize_control.slideDown(function () {
				widget_form_control.expandForm();
				widget_form_control.container.find( '.widget-inside :input:first' ).focus();
			});
		},

		/**
		 *
		 */
		populateAvailableWidgets: function() {
			var control = this;
			var select = control.container.find('.available-widgets');
			select.find('option:not(:first-child)').remove();
			self.available_widgets.each(function (widget) {
				var option = new Option(widget.get('name'), widget.get('id'));
				option.disabled = widget.get( 'is_disabled' );
				select.append(option);
			});
		},

		/**
		 * Listen for clicks on the .widget-control-remove link
		 */
		setupDeletion: function(){
			var control = this;
			control.control_section.on( 'click', '.widget-control-remove', function (e) {
				e.preventDefault();
				$(this).closest('.customize-control').slideUp(function (){
					$(this).remove();
					control.updatePreview();
					// @todo If removed widget was single (not a multi widget) then we now need to make any single widget available for adding
				});
			});
		}

	});

	/**
	 * Widget Form control
	 * Note that 'widget_form' must match the Widget_Form_WP_Customize_Control::$type
	 */
	customize.controlConstructor.widget_form = customize.Control.extend({

		/**
		 * Set up the control
		 */
		ready: function() {
			var control = this;

			control.setting.bind( function( to ) {
				control.updateWidget( to );
			});

			control.container.find( '.widget-control-save' ).on( 'click', function (e) {
				e.preventDefault();
				control.updateWidget();
			});

			control.container.find( '.widget-control-close' ).on( 'click', function (e) {
				e.preventDefault();
				control.collapseForm();
			} );

			var remove_btn = control.container.find( 'a.widget-control-remove' );
			remove_btn.text( self.i18n.remove_btn_label ); // wp_widget_control() outputs the link as "Delete"
			remove_btn.attr( 'title', self.i18n.remove_btn_tooltip );

			control.container.find( '.widget-top a.widget-action' ).on( 'keydown', function(e) {
				if ( 13 === e.which ){
					this.click();
				}
			});

			control.setting.previewer.channel.bind( 'synced', function () {
				control.container.removeClass( 'previewer-loading' );
			});

			control.setupControlToggle();
			control.setupWidgetTitle();
			control.editingEffects();
		},

		/**
		 * @param {object} [instance_override]  When the model changes, the instance is sent this way
		 */
		updateWidget: function ( instance_override ) {
			var control = this;
			var data = control.container.find(':input').serialize();

			control.container.addClass( 'widget-form-loading' );
			control.container.addClass( 'previewer-loading' );
			control.container.find( '.widget-content' ).prop( 'disabled', true );

			var params = {};
			params.action = self.update_widget_ajax_action;
			params[self.update_widget_nonce_post_key] = self.update_widget_nonce_value;
			if ( instance_override ) {
				params.json_instance_override = JSON.stringify( instance_override );
			}
			data += '&' + $.param( params );

			var jqxhr = $.post( wp.ajax.settings.url, data, function (r) {
				if ( r.success ) {
					control.container.find( '.widget-content' ).html( r.data.form );
					if ( ! instance_override ) {
						control.setting( r.data.instance );
					}
				}
				else {
					var message = 'FAIL';
					if ( r.data && r.data.message ) {
						message = r.data.message;
					}
					alert( message );
				}
			});
			jqxhr.fail( function (jqXHR, textStatus ) {
				alert( textStatus );
			});
			jqxhr.always( function () {
				control.container.find( '.widget-content' ).prop( 'disabled', false );
				control.container.removeClass( 'widget-form-loading' );
			});
		},

		/**
		 * Show/hide the control when clicking on the form title
		 */
		setupControlToggle: function() {
			var control = this;
			control.container.find('.widget-top').on( 'click', function (e) {
				control.toggleForm();
				e.preventDefault();
			} );
		},

		/**
		 * Expand the accordion section containing a control
		 */
		expandControlSection: function () {
			var section = this.container.closest( '.accordion-section' );
			if ( ! section.hasClass('open') ) {
				section.find('.accordion-section-title:first').trigger('click');
			}
		},

		/**
		 * Expand the widget form control
		 */
		expandForm: function () {
			this.toggleForm( true );
		},

		/**
		 * Collapse the widget form control
		 */
		collapseForm: function () {
			this.toggleForm( false );
		},

		/**
		 * Expand or collapse the widget control
		 * @param {boolean|undefined} [do_expand] If not supplied, will be inverse of current visibility
		 */
		toggleForm: function ( do_expand ) {
			var control = this;
			var widget = control.container.find('div.widget:first');
			var inside = widget.find('.widget-inside:first');
			if ( typeof do_expand === 'undefined' ) {
				do_expand = ! inside.is(':visible');
			}
			if ( do_expand ) {
				control.container.trigger('expand');
				inside.slideDown('fast');
			}
			else {
				control.container.trigger('collapse');
				inside.slideUp('fast', function() {
					widget.css({'width':'', 'margin':''});
				});
			}
		},

		/**
		 * Update the title of the form if a title field is entered
		 */
		setupWidgetTitle: function () {
			var control = this;
			control.setting.bind( function() {
				control.updateInWidgetTitle();
			});
			control.updateInWidgetTitle();
		},

		/**
		 * Set the widget control title based on any title setting
		 */
		updateInWidgetTitle: function () {
			var control = this;
			var title = control.setting().title;
			var in_widget_title = control.container.find('.in-widget-title');
			if ( title ) {
				in_widget_title.text( ': ' + title );
			}
			else {
				in_widget_title.text( '' );
			}
		},

		/**
		 * Inverse of WidgetCustomizer.getControlInstanceForWidget
		 * @return {jQuery}
		 */
		getPreviewWidgetElement: function () {
			var control = this;
			var iframe_contents = $('#customize-preview').find('iframe').contents();
			return iframe_contents.find('#' + control.params.widget_id);
		},

		/**
		 * Inside of the customizer preview, scroll the widget into view
		 */
		scrollPreviewWidgetIntoView: function () {
			var control = this;
			var widget_el = control.getPreviewWidgetElement();
			if ( widget_el.length ) {
				widget_el[0].scrollIntoView( false );
			}
		},

		/**
		 * Highlight the widget control and section
		 */
		highlightSectionAndControl: function() {
			var control = this;
			var target_element;
			if ( control.container.is(':hidden') ) {
				target_element = control.container.closest('.control-section');
			}
			else {
				target_element = control.container;
			}

			$('.widget-customizer-highlighted').removeClass('widget-customizer-highlighted');
			target_element.addClass('widget-customizer-highlighted');
			setTimeout( function () {
				target_element.removeClass('widget-customizer-highlighted');
			}, 500 );
		},

		/**
		 * Add the widget-customizer-highlighted-widget class to the widget for 500ms
		 */
		highlightPreviewWidget: function () {
			var control = this;
			var widget_el = control.getPreviewWidgetElement();
			var root_el = widget_el.closest('html');
			root_el.find('.widget-customizer-highlighted-widget').removeClass('widget-customizer-highlighted-widget');
			widget_el.addClass('widget-customizer-highlighted-widget');
			setTimeout( function () {
				widget_el.removeClass('widget-customizer-highlighted-widget');
			}, 500 );
		},

		/**
		 * Highlight widgets in the preview when
		 */
		editingEffects: function() {
			var control = this;

			// Highlight whenever hovering or clicking over the form
			control.container.on('mouseenter click', function () {
				control.highlightPreviewWidget();
			});

			// Highlight when the setting is updated
			control.setting.bind( function() {
				control.scrollPreviewWidgetIntoView();
				control.highlightPreviewWidget();
			});

			// Highlight when the widget form is expanded
			control.container.on('expand', function () {
				control.scrollPreviewWidgetIntoView();
			});

		}
	});

	/**
	 * Given a widget_id for a widget appearing in the preview.
	 * @param {string} widget_id
	 * @return {null|object}
	 */
	self.getControlInstanceForWidget = function ( widget_id ) {
		var widget_control = null;
		wp.customize.control.each(function ( control ) {
			if ( control.params.type === 'widget_form' && control.params.widget_id === widget_id ) {
				widget_control = control;
				// @todo How do we break?
			}
		});
		return widget_control;
	};

	return self;
}( jQuery ));
