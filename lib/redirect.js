'use strict'

var url = require('url')
var isUrl = /^https?:/

function Redirect (request) {
  this.request = request
  this.followRedirect = true
  this.followRedirects = true
  this.followAllRedirects = false
  this.allowRedirect = function () {return true}
  this.maxRedirects = 10
  this.redirects = []
  this.redirectsFollowed = 0
}

Redirect.prototype.onRequest = function () {
  var self = this
    , request = self.request

  if (request.maxRedirects !== undefined) {
    self.maxRedirects = request.maxRedirects
  }
  if (typeof request.followRedirect === 'function') {
    self.allowRedirect = request.followRedirect
  }
  if (request.followRedirect !== undefined) {
    self.followRedirects = !!request.followRedirect
  }
  if (request.followAllRedirects !== undefined) {
    self.followAllRedirects = request.followAllRedirects
  }
  if (self.followRedirects || self.followAllRedirects) {
    self.redirects = self.redirects || []
  }
}

Redirect.prototype.redirectTo = function (response) {
  var self = this
    , request = self.request

  var redirectTo = null
  if (response.statusCode >= 300 && response.statusCode < 400 && response.caseless.has('location')) {
    var location = response.caseless.get('location')
    // debug('redirect', location)

    if (self.followAllRedirects) {
      redirectTo = location
    } else if (self.followRedirects) {
      switch (request.method) {
        case 'PATCH':
        case 'PUT':
        case 'POST':
        case 'DELETE':
          // Do not follow redirects
          break
        default:
          redirectTo = location
          break
      }
    }
  } else if (response.statusCode === 401) {
    var authHeader = request._auth.onResponse(response)
    if (authHeader) {
      request.setHeader('authorization', authHeader)
      redirectTo = request.uri
    }
  }
  return redirectTo
}

Redirect.prototype.onResponse = function (response) {
  var self = this
    , request = self.request

  var redirectTo = self.redirectTo(response)
  if (!redirectTo || !self.allowRedirect.call(request, response)) {
    return false
  }


  // debug('redirect to', redirectTo)

  // ignore any potential response body.  it cannot possibly be useful
  // to us at this point.
  if (request._paused) {
    response.resume()
  }

  if (self.redirectsFollowed >= self.maxRedirects) {
    request.emit('error', new Error('Exceeded maxRedirects. Probably stuck in a redirect loop ' + request.uri.href))
    return false
  }
  self.redirectsFollowed += 1

  if (!isUrl.test(redirectTo)) {
    redirectTo = url.resolve(request.uri.href, redirectTo)
  }

  var uriPrev = request.uri
  request.uri = url.parse(redirectTo)

  // handle the case where we change protocol from https to http or vice versa
  if (request.uri.protocol !== uriPrev.protocol) {
    request._updateProtocol()
  }

  self.redirects.push(
    { statusCode : response.statusCode
    , redirectUri: redirectTo
    }
  )
  if (self.followAllRedirects && response.statusCode !== 401 && response.statusCode !== 307) {
    request.method = 'GET'
  }
  // request.method = 'GET' // Force all redirects to use GET || commented out fixes #215
  delete request.src
  delete request.req
  delete request.agent
  delete request._started
  if (response.statusCode !== 401 && response.statusCode !== 307) {
    // Remove parameters from the previous response, unless this is the second request
    // for a server that requires digest authentication.
    delete request.body
    delete request._form
    if (request.headers) {
      request.removeHeader('host')
      request.removeHeader('content-type')
      request.removeHeader('content-length')
      if (request.uri.hostname !== request.originalHost.split(':')[0]) {
        // Remove authorization if changing hostnames (but not if just
        // changing ports or protocols).  This matches the behavior of curl:
        // https://github.com/bagder/curl/blob/6beb0eee/lib/http.c#L710
        request.removeHeader('authorization')
      }
    }
  }

  request.emit('redirect')

  request.init()

  return true
}

exports.Redirect = Redirect