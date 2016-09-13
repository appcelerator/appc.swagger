var request = require('superagent');
var _ = require('lodash');

/**
 * Contructor function for oauth authentication
 *
 * @param {Array} scopes Username for basic authentication
 */
var OauthAuthentication = module.exports = function (providerConfig, scopes) {
	this.providerConfig = providerConfig;
	this.flow = providerConfig.securityDefinition.flow;
	this.tokenUrl = providerConfig.securityDefinition.tokenUrl;
	this.requestContentType = providerConfig.requestContentType || 'form';
	this.scopes = scopes;
	// FIXME: Maybe use some kind of persistence to store and load the token if the app restarts?
	this.token = null;

	this.validateConfiguration();
};

/**
 * Checks wether this oauth authentication provider has a valid and supported
 * configuration or not.
 *
 * @return {void}
 * @throws Error Error describing the invalid configuration value
 */
OauthAuthentication.prototype.validateConfiguration = function () {
	if (!_.includes(['password', 'application'], this.flow)) {
		throw new Error('Only "password" and "application (client credentials)" flows are currntly supported.');
	}

	if (!this.providerConfig.client_id || !this.providerConfig.client_secret) {
		throw new Error('You must specify a client_id and client_secret for oauth providers.');
	}
};

/**
 * Sets the logger to use for debug and trace logging
 *
 * @param {Logger} logger
 * @return {void}
 */
OauthAuthentication.prototype.injectLogger = function (logger) {
	this.logger = logger;
};

/**
 * Applies the oauth bearer token
 *
 * If the token is expired or we don't have one yet, request a new one and
 * then apply it to the request.
 *
 * @param {Request} request Superagent request object
 * @param {Function} callback Function to call after authentication is applied
 * @return {void}
 */
OauthAuthentication.prototype.apply = function (request, callback) {
	var that = this;
	var now = new Date();
	if (this.token && this.token.expiryDate < now) {
		this.applyBearerToken(request);
		return callback();
	}

	/**
	 * Parses the oauth token response, stores it as new token and then applies it
	 * to the request
	 *
	 * @param {Object} oauthResponse Response from oauth with the token information
	 * @return {void}
	 */
	var parseAndApplyToken = function (err, oauthResponse) {
		if (err) {
			that.logger.debug('Error requesting oauth token, response was: ' + JSON.stringify(oauthResponse.body));
			return callback(err);
		}

		that.logger.trace('Parsing and applying oauth response: ' + JSON.stringify(oauthResponse.body));

		var oauthToken = oauthResponse.body;
		that.token = {
			accessToken: oauthToken.access_token
		};

		// expires_in and refresh token are optional
		var expiresIn = oauthToken.expires_in ? oauthToken.expires_in : that.defaultExpiryTime;
		var now = new Date();
		that.token.expiryDate = new Date(now.getTime() + expiresIn * 10);
		if (oauthToken.refresh_token) {
			that.token.refreshToken = oauthToken.refresh_token;
		}

		that.applyBearerToken(request);
		return callback();
	};

	if (this.token && this.token.refreshToken) {
		this.requestRefreshToken(parseAndApplyToken);
	} else if (this.flow === 'password') {
		this.requestResourceOwnerPasswordCredentialsGrantAccessToken(parseAndApplyToken);
	} else if (this.flow === 'application') {
		this.requestClientCredentialsGrantAccessToken(parseAndApplyToken);
	}
};

/**
 * Applies the bearer token to the request by setting the appropriate header
 *
 * @param {Request} request Request object
 * @return {void}
 */
OauthAuthentication.prototype.applyBearerToken = function (request) {
	request.set('Authorization', 'Bearer ' + this.token.accessToken);
};

/**
 * Requests a new access token using resource owner grant type
 *
 * @param {Function} callback Function to call with the received oauth response
 * @return {void}
 */
OauthAuthentication.prototype.requestResourceOwnerPasswordCredentialsGrantAccessToken = function (callback) {
	this.requestAccessToken({
		grant_type: 'password',
		username: this.providerConfig.username,
		password: this.providerConfig.password,
		client_id: this.providerConfig.client_id,
		client_secret: this.providerConfig.client_secret,
		scope: this.scopes
	}, callback);
};

/**
 * Requests a new access token using client credential grant type
 *
 * @param {Function} callback Function to call with the received oauth response
 * @return {void}
 */
OauthAuthentication.prototype.requestClientCredentialsGrantAccessToken = function (callback) {
	this.requestAccessToken({
		grant_type: 'client_credentials',
		client_id: this.providerConfig.client_id,
		client_secret: this.providerConfig.client_secret,
		scope: this.scopes
	}, callback);
};

/**
 * Requests a new access token using refresh token grant type
 *
 * @param {Function} callback Function to call with the received oauth response
 * @return {void}
 */
OauthAuthentication.prototype.requestRefreshToken = function (callback) {
	this.requestAccessToken({
		grant_type: 'refresh_token',
		refresh_token: this.token.refreshToken,
		client_id: this.providerConfig.client_id,
		client_secret: this.providerConfig.client_secret
	}, callback);
};

/**
 * Makes a request to the token url to retreive a new token
 *
 * @param {Object} parameters The parameters to send with the request
 * @param {Function} callback Function to call as the request callback
 * @return {void}
 */
OauthAuthentication.prototype.requestAccessToken = function (parameters, callback) {
	if (parameters.scope && parameters.scope.length === 0) {
		delete parameters.scope;
	}
	this.logger.debug('Requesting token from ' + this.tokenUrl + ', parameters: ' + JSON.stringify(parameters));
	request.post(this.tokenUrl)
		.type(this.requestContentType)
		.send(parameters)
		.end(callback);
};